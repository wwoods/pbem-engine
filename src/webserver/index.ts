/** The webserver which does two things:
 * 
 * 1. Serves HTTP requests to deliver a compiled version of the app.
 * 
 * 2. Runs the server-side game logic.
 * */

import bodyParser from 'body-parser';
import {execFile} from 'child_process';
import chokidar from 'chokidar';
import createDebug from 'debug';
import express from 'express';
import expressHttpProxy from 'express-http-proxy';
import expressMung from 'express-mung';
import {promises as fs} from 'fs';
import http from 'http';
import NodeCache from 'node-cache';
import path from 'path';
import process from 'process';
import SuperLogin from '@wwoods/superlogin';
import tmp from 'tmp-promise';

import {_pbemGameSetup, _PbemSettings} from '../game';
import {sleep} from '../server/common';
import { DbUser, DbGameDoc, DbUserId, DbGame } from '../server/db';
import {ServerGameDaemonController} from '../server/gameDaemonController';
import PouchDb from '../server/pouch';

/** NOTE: dbPath includes username and password! */
export async function run(gameCode: string, webAppCompiled: string | number, 
    dbPath: string | undefined) {
  createDebug.enable('pbem-engine:*');

  let app = express();
  app.set('port', process.env.PORT || 8080);

  // The application needs an easy way to refer to the remote database.  To
  // enable this, we route it next to the application.
  const db = dbPath !== undefined ? dbPath : 'http://localhost:5984';
  if (db.indexOf('//') === -1) throw new Error('DB path must have http://');
  const dbNoProtocol = db.slice(db.indexOf('//')+2);
  const dbAt = dbNoProtocol.indexOf('@');
  const dbNoUserInfo = dbNoProtocol.slice(dbAt + 1);
  const dbUserInfo = dbAt === -1 ? ':' : dbNoProtocol.substr(0, dbAt);
  app.use('/db', expressHttpProxy(db));

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

  const protocolAndHost = db.split('//');
  const config = {
    dbServer: {
      protocol: protocolAndHost[0] + '//',
      host: dbNoUserInfo,
      user: dbUserInfo.split(':')[0],
      password: dbUserInfo.split(':')[1],
      userDB: 'sl-users',
      couchAuthDB: '_users',
    },
    security: {
      // Annual logins - it's a game.  Security is not our biggest concern.
      sessionLife: 86400 * 365,
    },
    testMode: {
      noEmail: true,
    },
    mailer: {
    },
    userDBs: {
      defaultDBs: {
        private: ['pbem'],
      },
    },
  };

  let superLogin = new SuperLogin(config);
  app.use('/auth/login', expressMung.json((body, req, res) => {
    const b = body as any;
    if (res.statusCode === 200) {
      // Overwrite DB with appropriate, routed path.
      for (const dbName of Object.keys(b.userDBs)) {
        let db = b.userDBs[dbName];
        const splitter = '@' + dbNoUserInfo + '/';
        db = db.split(splitter).slice(1).join(splitter);
        b.userDBs[dbName] = db;
      }
    }
    return b;
  }));
  app.use('/auth', superLogin.router);

  // Set up database pool.
  const dbCache = new NodeCache({
    stdTTL: 5 * 60,
    useClones: false,
  });
  const dbResolver = (dbName: string) => {
    let dbObj: PouchDB.Database<DbUser> | undefined;
    dbObj = dbCache.get(dbName);
    if (dbObj === undefined) {
      dbObj = new PouchDb<DbUser>([db, dbName].join('/'), {skip_setup: true});
      // Fire off a compact when we load a DB for the first time.
      dbObj.compact();
    }
    return dbObj!;
  };

  // Add PBEM API
  const dbGameIndex = new PouchDb(db + '/pbem-games');
  try {
    await dbGameIndex.createIndex({index: {fields: ['phase']}});
  }
  catch (e) {
    console.warn(`Unable to createIndex: ${e}`);
  }
  app.post('/pbem/createSystem', superLogin.requireAuth, async (req: any, res: any) => {
    // userID == dbName == pbem$ prefix.
    const userId = 'pbem$' + req.user._id;

    const s = _PbemSettings.create();
    
    // Populate player 1 with host
    s.players[0] = {
      name: req.user._id, // remove pbem$
      status: 'joined',
      dbId: {
        type: 'remote',
        id: userId,
      },
      playerSettings: {},
      index: 0,
    };

    const gameHost: DbUserId = {
      type: 'system',
      id: 'gameId',
    };
    const gameDoc: DbGameDoc = {
      _id: 'gameId',
      game: 'gameId',
      type: 'game-data',
      host: gameHost,
      hostName: s.players[0].name,
      createdBy: {
        type: 'remote',
        id: userId,
      },
      initNeeded: true,
      phase: 'staging',
      settings: s,
    };

    let gameId = 'game';
    while (true) {
      gameId = 'game' + dbGameIndex.getUuid().substr(0, 8);
      gameDoc._id = gameId;
      gameDoc.game = gameId;
      gameHost.id = gameId;
      try {
        const resp = await dbGameIndex.put(gameDoc);
        (gameDoc as any)._rev = resp.rev;
        break;
      }
      catch (e) {
        if (e.name !== 'conflict') throw e;
      }
    }
    
    const dbGame = new PouchDb<DbGame>([db, gameId].join('/'));
    // Will trigger host invitation / membership.
    // Use replicate, since future changes to game-data will replicate to 
    // dbGameIndex
    await dbGameIndex.replicate.to(dbGame, {
      doc_ids: [gameDoc._id!],
    });

    let foundMember = false;
    while (!foundMember) {
      const r = await dbGame.changes({include_docs: true});
      for (const d of r.results) {
        if (d.doc!.type === 'game-response-member') {
          foundMember = true;
          break;
        }
      }
      await sleep(500);
    }

    res.json({ id: gameId });
  });
  app.post('/pbem/list', superLogin.requireAuth, async (req, res) => {
    const r = await dbGameIndex.find({
      selector: {
        phase: 'staging',
        ended: {$exists: false},
        initNeeded: {$exists: false},
      },
      limit: 10,
    });
    res.json(r.docs);
  });

  let isProduction: boolean = typeof webAppCompiled === 'string';
  if (isProduction) {
    // Production mode - web app was compiled
    app.use(express.static(webAppCompiled as string));
    if (false) {
      // Support HTML5 history
      // NOTE: Doesn't play well with PWA.
      app.all('/game*', (req: any, res: any) => {
        res.sendFile('index.html', {root: webAppCompiled});
      });
      app.all('/staging*', (req: any, res: any) => {
        res.sendFile('index.html', {root: webAppCompiled});
      });
    }
  }
  else {
    // Proxy to development server
    app.use(expressHttpProxy(`http://localhost:${webAppCompiled}`));
  }

  http.createServer(app).listen(app.get('port'));

  // Connect user game code to pbem-engine code.
  await _connectUserCode(gameCode, isProduction);

  // Now run our service
  await _runServer(db, dbResolver);
}


/** Build user game code in a nodeJS-compatible manner, and plug it into 
 * pbem-engine's game hooks.
 * 
 * If not production, also watch for changes using chokidar.
 * */
async function _connectUserCode(gameCode: string, isProduction: boolean) {
  // Ideally this would steal from Vue's compilation process, but that is 
  // compiled for use in browser.  We need a node-compatible version.

  const exists = async (p: string) => {
    try {
      await fs.stat(p);
      return true;
    }
    catch (e) {
      return false;
    }
  };

  // Path to game source file/directory
  let gameSourcePath = path.join(path.resolve(gameCode), 'src', 'game');
  if (!await exists(gameSourcePath)) {
    if (await exists(gameSourcePath + '.js')) {
      gameSourcePath += '.js';
    }
    else if (await exists(gameSourcePath + '.ts')) {
      gameSourcePath += '.ts';
    }
    else {
      throw new Error(`Could not find game source? ${gameSourcePath}`);
    }
  }

  // We may need to import some modules (e.g., "tslib") from the game.
  const gameNodeModules = path.join(path.resolve(gameCode), 'node_modules');
  process.env.NODE_PATH = gameNodeModules + (
      process.env.NODE_PATH !== undefined ? ':' + process.env.NODE_PATH : '');
  require('module').Module._initPaths();

  // IF typescript:
  // 1. Fork tsconfig.json
  // 2. Modify "compilerOptions"
  //    a. module -> commonjs
  //    b. outDir -> Something temporary (rimraf on exit)
  //    c. "include", prefix all "src" extensions with "game*"
  let tsFile: string | undefined;
  let modulePath: string = gameSourcePath;
  let maybeTsFile = path.join(gameCode, 'tsconfig.json');
  if (await exists(maybeTsFile)) {
    tsFile = "pbem-server-tsconfig.json";
    let contents = JSON.parse((await fs.readFile(maybeTsFile)).toString());
    contents.compilerOptions.module = "commonjs";
    contents.compilerOptions.outDir = modulePath = (await tmp.dir({
      unsafeCleanup: true,
    })).path;
    for (let i = contents.include.length - 1; i > -1; i -= 1) {
      const p = contents.include[i];
      if (p.endsWith('.vue') || p.endsWith('.tsx')) {
        contents.include.splice(i, 1);
        continue;
      }

      if (contents.include[i].startsWith("src")) {
        contents.include[i] = contents.include[i].replace(/(\*\.[a-zA-Z]+)$/, 'game*$1');
      }
    }
    await fs.writeFile(path.join(gameCode, tsFile), JSON.stringify(contents));
  }

  let compileActive = false;
  let compileQueued = false;
  const compile = async () => {
    if (compileActive) {
      if (compileQueued) return;
      compileQueued = true;
      while (compileActive) {
        await sleep(100);
      }
      compileQueued = false;
    }
    compileActive = true;

    try {
      // 3. Run tsc -b tsconfigFork.json [-i? don't know]
      // 4. Require compiled config, for "game" module
      if (tsFile !== undefined) {
        await new Promise((resolve, reject) => {
          execFile(
            'npx', 
            ['--no-install', 'tsc', '-b', tsFile!], 
            {
              cwd: gameCode,
            },
            (err, stdout, stderr) => {
              if (err) {
                // If compilation fails, the UI compilation or serving will
                // show the error.
                //reject(err);
              }
              resolve(stdout);
            });
        });
      }

      // Bust the cache before reloading.
      for (const p of Object.keys(require.cache)) {
        if (p.startsWith(modulePath)) {
          delete require.cache[p];
        }
      }
      // Re-assign hooks; these are called into, so no other hot-reload code 
      // should be necessary.
      let ok = false;
      try {
        const {Settings, State, Action} = require(path.join(modulePath, 'game'));
        ok = true;
        _pbemGameSetup(Settings.Hooks, State.Hooks, Action.Types);
      }
      catch (e) {
        _pbemGameSetup(undefined as any, undefined as any, undefined as any);
        if (ok) { throw e; }
      }
    }
    finally {
      compileActive = false;
    }
  };

  await compile();

  if (!isProduction) {
    const watcher = chokidar.watch(gameSourcePath);
    watcher.on('ready', function() {
      watcher.on('all', function() {
        compile().catch(console.error);
      });
    });
  }
}


/** Note that db includes user:pass information. */
async function _runServer(db: string, 
    dbResolver: {(dbName: string): PouchDB.Database<DbUser> | undefined}) {
  // Ensure that _global_changes exists
  const globalChanges = new PouchDb(db + '/_global_changes');
  setInterval(globalChanges.compact.bind(globalChanges), 10 * 1000);

  await ServerGameDaemonController.init(new PouchDb([db, 'pbem-daemon'].join('/')));

  const c = globalChanges.changes({
    live: true,
    // TODO: on init, start from now?  Or start from 0?
  });
  c.on('change', (info) => {
    let dbName = info.id.slice(info.id.indexOf(':') + 1);
    if (['pbem-daemon', 'pbem-games', 'sl-users', '_dbs', '_users'].indexOf(dbName) !== -1) {
      // Ignore system databases
      return;
    }
    console.log(dbName);
    const dbConn = dbResolver(dbName)!;
    ServerGameDaemonController.runForDb(dbConn, dbResolver, 'remote', 
      undefined);
  });
}
