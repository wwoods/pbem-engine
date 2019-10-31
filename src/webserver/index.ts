/** The webserver which does two things:
 * 
 * 1. Serves HTTP requests to deliver a compiled version of the app.
 * 
 * 2. Runs the server-side game logic.
 * */

import bodyParser from 'body-parser';
import express from 'express';
import expressHttpProxy from 'express-http-proxy';
import expressMung from 'express-mung';
import http from 'http';
import NodeCache from 'node-cache';
import path from 'path';
import process from 'process';
import SuperLogin from '@wwoods/superlogin';

import {_pbemGameSetup} from '../game';
import { DbUser } from '../server/db';
import {ServerGameDaemonController} from '../server/gameDaemonController';
import PouchDb from '../server/pouch';

/** NOTE: dbPath includes username and password! */
export async function run(gameCode: string, webAppCompiled: string | number, 
    dbPath: string | undefined) {
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

  if (typeof webAppCompiled === 'string') {
    // Production mode - web app was compiled
    app.use(express.static(webAppCompiled));
    // Support HTML5 history
    app.all('/game*', (req: any, res: any) => {
      res.sendFile('index.html', {root: webAppCompiled});
    });
    app.all('/staging*', (req: any, res: any) => {
      res.sendFile('index.html', {root: webAppCompiled});
    });
  }
  else {
    // Proxy to development server
    app.use(expressHttpProxy(`http://localhost:${webAppCompiled}`));
  }

  http.createServer(app).listen(app.get('port'));

  // Connect user game code to pbem-engine code.
  console.log(gameCode);
  const {Settings, State, Action} = require(path.join(path.resolve(gameCode), 
    '/game'));
  _pbemGameSetup(Settings.Hooks, State.Hooks, Action.Types);

  // Now run our service
  _runServer(db);
}


/** Note that db includes user:pass information. */
function _runServer(db: string) {
  // Ensure that _global_changes exists
  const globalChanges = new PouchDb(db + '/_global_changes');
  setInterval(globalChanges.compact.bind(globalChanges), 10 * 1000);

  const dbCache = new NodeCache({
    stdTTL: 5 * 60,
    useClones: false,
  });
  const dbResolver = (dbName: string) => {
    let db: PouchDB.Database<DbUser> | undefined;
    db = dbCache.get(dbName);
    if (db === undefined) {
      db = new PouchDb<DbUser>([db, dbName].join('/'));
      // Fire off a compact when we load a DB for the first time.
      db.compact();
    }
    return db!;
  };

  ServerGameDaemonController.init(dbResolver('pbem-daemon'));

  const c = globalChanges.changes({
    live: true,
    // TODO: on init, start from now?  Or start from 0?
  });
  c.on('change', (info) => {
    let dbName = info.id.slice(info.id.indexOf(':') + 1);
    if (['pbem-daemon', 'sl-users', '_dbs', '_users'].indexOf(dbName) !== -1) {
      // Ignore system databases
      return;
    }
    console.log(dbName);
    const dbConn = dbResolver(dbName);
    ServerGameDaemonController.runForDb(dbConn, dbResolver, 'remote', 
      undefined);
  });
}
