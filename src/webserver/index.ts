/** The webserver which does two things:
 * 
 * 1. Serves HTTP requests to deliver a compiled version of the app.
 * 
 * 2. Runs the server-side game logic.
 * */
import process from 'process';

import bodyParser from 'body-parser';
import express from 'express';
import expressMung from 'express-mung';
import http from 'http';
import request from 'request';
import SuperLogin from '@wwoods/superlogin';

export async function run(webAppCompiled: string | number, 
    dbPath: string | undefined) {
  let app = express();
  app.set('port', process.env.PORT || 8080);

  // The application needs an easy way to refer to the remote database.  To
  // enable this, we route it next to the application.
  const db = dbPath !== undefined ? dbPath : 'http://localhost:5984';
  const dbNoProtocol = db.split('//').splice(1).join('//');
  const dbRegex = /^\/db(.*)$/;
  app.use((req: any, res: any, next: any) => {
    const proxyPath = req.path.match(dbRegex);
    if (proxyPath) {
      req.pipe(request({
        uri: db + proxyPath[1],
        method: req.method,
      })).pipe(res);
    }
    else {
      next();
    }
  });

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

  const protocolAndHost = db.split('//');
  const config = {
    dbServer: {
      protocol: protocolAndHost[0] + '//',
      host: protocolAndHost.slice(1).join('//'),
      user: '',
      password: '',
      userDB: 'sl-users',
      couchAuthDB: '_users',
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
        const splitter = '@' + dbNoProtocol;
        db = db.split(splitter).splice(1).join(splitter);
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
    app.use((req, res, next) => {
      req.pipe(request({
        uri: `http://localhost:${webAppCompiled}${req.path}`,
        method: req.method,
      })).pipe(res);
    });
  }

  http.createServer(app).listen(app.get('port'));
}
