/** The webserver which does two things:
 *
 * 1. Serves HTTP requests to deliver a compiled version of the app.
 *
 * 2. Runs the server-side game logic.
 * */

import bodyParser from 'body-parser';
import {ChildProcess, execFile, spawn} from 'child_process';
import chokidar from 'chokidar';
import createDebug from 'debug';
import express from 'express';
import expressHttpProxy from 'express-http-proxy';
import expressMung from 'express-mung';
//import expressPouch from 'express-pouchdb';
import {promises as fs} from 'fs';
import http from 'http';
import NodeCache from 'node-cache';
import path from 'path';
import process from 'process';
import secureRandomPassword from 'secure-random-password';
import SuperLogin from '@wwoods/superlogin';
import tmp from 'tmp-promise';
import url from 'url';

import {_pbemGameSetup, _PbemSettings} from '../game';
import {sleep} from '../server/common';
import { DbUser, DbGameDoc, DbUserId, DbGame } from '../server/db';
import {ServerGameDaemonController} from '../server/gameDaemonController';
import PouchDb from '../server/pouch';

/** NOTE: dbPath includes username and password! */
export async function run(gameCode: string, webAppCompiled: string | number, 
    dbPath: string) {
  createDebug.enable('pbem-engine:*');

  let app = express();
  app.set('port', process.env.PORT || 8080);

  //TODO figure out why createSystem() endpoint never returns... after github issue on _global_changes.

  // The application needs an easy way to refer to the remote database.  To
  // enable this, we route it next to the application.
  let dbIsRemote: boolean = dbPath.indexOf('//') !== -1;
  let dbUser: string, dbPassword: string, dbProtocol: string, dbHost: string;

  let PouchInternal = PouchDb.defaults({prefix: dbPath});
  let dbExpressHandler: any;
  if (dbIsRemote) {
    const dbNoProtocol = dbPath.slice(dbPath.indexOf('//')+2);
    const dbAt = dbNoProtocol.indexOf('@');
    const dbNoUserInfo = dbNoProtocol.slice(dbAt + 1);
    const dbUserInfo = dbAt === -1 ? ':' : dbNoProtocol.substr(0, dbAt);

    dbUser = dbUserInfo.split(':')[0];
    dbPassword = dbUserInfo.split(':')[1];
    dbProtocol = dbPath.slice(0, dbPath.indexOf('//')+2);
    dbHost = dbNoUserInfo;

    dbExpressHandler = expressHttpProxy(dbProtocol + dbNoUserInfo);
  }
  else {
    if (dbPath !== 'local') {
      throw new Error('Not implemented: local storage.  Basically, '
        + "since pouchdb-server doesn't work with _global_changes, "
        + "and docker binds don't work on windows (plus permission issues "
        + "on Linux), local storage uses a named volume.");
    }
    //if (!dbPath.endsWith('/')) throw new Error('Db path must end in "/"');
    //// Ensure folder exists (trailing slash important)
    //try {
    //  await fs.mkdir(dbPath);
    //}
    //catch (e) {
    //  if (e.code !== 'EEXIST') throw e;
    //}

    // It turns out, pouchdb-server doesn't work as _global_changes is
    // unsupported at this time (https://github.com/pouchdb/pouchdb-server/issues/421).
    // Instead, we'll run a specific couchdb docker container on a random port
    // s.t. we can access it and still store files locally.
    //
    // https://hub.docker.com/_/couchdb
    // Can use COUCHDB_USER, COUCHDB_PASSWORD for local admin.
    // /opt/couchdb/data is where data goes...

    const couchVersion = 'couchdb:2.3.1';

    dbUser = 'pbemAdminUser';
    // Choose a completely random, one-time password.  Should only be accessed
    // through e.g. superlogin.
    dbPassword = secureRandomPassword.randomPassword({
      length: 32,
      characters: secureRandomPassword.lower + secureRandomPassword.upper
        + secureRandomPassword.digits,
    });
    console.log(`PBEM /db Credentials: ${dbUser} / ${dbPassword}`);
    dbProtocol = 'http://';
    // Would use "localhost", but e.g. Docker has issues, so keep it to
    // 127.0.0.1
    dbHost = `127.0.0.1:${app.get('port')}/db`;

    const dbRoute = `http://127.0.0.1:${app.get('port')+1}`
    dbExpressHandler = expressHttpProxy(dbRoute);

    // dbPath used when creating DBs -- needs uname + password
    dbPath = `${dbProtocol}${dbUser}:${dbPassword}@${dbHost}`;
    PouchInternal = PouchDb.defaults({prefix: dbPath});

    /* Old code, for express-pouch.
    const pouchApp = expressPouch(
      PouchInternal,
      {
        logPath: dbPath + 'log.txt',
        inMemoryConfig: true,
      },
    );
    const p = new Promise((resolve, reject) => {
      pouchApp.couchConfig.set('admins', dbUser, dbPassword, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await p;
    dbExpressHandler = pouchApp;
     */

    // Instead, launch couchdb
    let couchDb: ChildProcess;
    try {
      //const volName = path.resolve(dbPath);
      const volName = path.resolve(gameCode).replace(/[\\\/:]/g, '--').replace(/^-*/, '');
      console.log(`DOCKER VOLUME IS ${volName}`);
      couchDb = spawn('docker',
        ['run', '--rm',
          '-e', `COUCHDB_USER=${dbUser}`,
          '-e', `COUCHDB_PASSWORD=${dbPassword}`,
          '-p', `${app.get("port")+1}:5984`,
          '--mount', `type=volume,src=${volName},dst=/opt/couchdb/data`,
          couchVersion,
        ]);
    }
    catch (e) {
      console.log('Using a local DB path requires both docker to be installed '
        + `and for port ${app.get("port")+1} to be available.  This is `
        + 'so that a local CouchDB instance may be launched.');
      throw e;
    }
    couchDb.on('close', (code: number) => {
      process.exitCode = code;
      console.log('couchdb exited');
      process.exit();
    });
    process.on('exit', () => {
      couchDb.kill();
    });

    // Wait for server to be available
    const tryWait = 100; //ms
    let tries = 100;
    while (true) {
      const p = new Promise((resolve, reject) => {
        const req = http.request(dbRoute, (r) => {
          // Server is accessible, all OK
          resolve();
        });
        req.on('error', (e) => {
          setTimeout(() => {reject(e)}, tryWait);
        });
        req.end();
      });
      try {
        await p;
        console.log('couchdb CONNECTION OK');
        break;
      }
      catch (e) {
        tries -= 1;
        if (tries === 0) {
          throw e;
        }
      }
    }
  }
  app.use('/db', dbExpressHandler);

  // Either way,  as per https://github.com/pouchdb/pouchdb-server/issues/183,
  // re-route Fauxton urls which were malformed.
  const fauxtonIntercept = (req: any, res: any, next: any) => {
    let referer = req.header('Referer');
    if (!referer) return next();

    let parsed = url.parse(referer);
    if (0 === parsed.pathname!.indexOf('/db/_utils/')) {
      return dbExpressHandler(req, res);
    }
    return next();
  };
  app.use(fauxtonIntercept);

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

  if (!dbIsRemote) {
    // IMPORTANT: before instantiating SuperLogin(), must have DB accessible.
    // When using local DB via express-pouch, that's now.
    http.createServer(app).listen(app.get('port'));
  }

  const config = {
    dbServer: {
      protocol: dbProtocol,
      host: dbHost,
      user: dbUser,
      password: dbPassword,
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
        const splitter = '@' + dbHost + '/';
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
      dbObj = new PouchInternal<DbUser>(dbName, {skip_setup: true});
      // Fire off a compact when we load a DB for the first time.
      dbObj.compact();
    }
    return dbObj!;
  };

  // Add PBEM API
  const dbGameIndex = new PouchInternal('pbem-games');
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
    
    const dbGame = new PouchInternal<DbGame>(gameId);
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

  if (dbIsRemote) {
    http.createServer(app).listen(app.get('port'));
  }

  // Connect user game code to pbem-engine code.
  await _connectUserCode(gameCode, isProduction);

  // Now run our service
  await _runServer(dbPath, dbResolver);
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
