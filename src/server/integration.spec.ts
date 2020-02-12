import {DbUser} from './db';
import {ServerGameDaemon} from './gameDaemon';
import {DaemonStatus, DaemonToken} from './gameDaemonController';
import PouchDb from './pouch';

import {ChildProcess, spawn} from 'child_process';
import http from 'http';

describe('test', () => {
  let couchDbPort = 7575;
  let couchDbInstance: ChildProcess;
  const couchDbPath = `http://127.0.0.1:${couchDbPort}/`;
  beforeAll(async () => {
    jest.setTimeout(10000);

    // Start new, transient couchDb instance with a given port.
    couchDbInstance = spawn('docker', ['run', '--rm',
        '-p', `${couchDbPort}:5984`,
        'couchdb:2.3.1',
    ], {
      stdio: 'ignore',
    });
    // Wait for couchdb to spin up
    let tries = 100;
    const tryWait = 100;
    while (tries > 0) {
      const p = new Promise((resolve, reject) => {
        const req = http.request(couchDbPath, (r) => {
          // Server OK
          resolve();
        });
        req.on('error', (e) => {
          setTimeout(() => {reject(e)}, tryWait);
        });
        req.end();
      });
      try {
        await p;
        console.log('OK');
        break;
      }
      catch (e) {
        tries -= 1;
        if (tries === 0) throw e;
      }
    }
  });
  afterAll(() => {
    couchDbInstance.kill();
  });

  let Pouch = PouchDb.defaults({prefix: couchDbPath});

  beforeEach(async () => {
  });

  test("start a game, run some actions", async () => {
    const gameId = 'int-s-game';

    const dbGame = new Pouch<DbUser>(`${gameId}`);

    // Set up the token watcher
    const dbDaemon = new Pouch(`${gameId}-daemon`);
    const token: DaemonStatus = {_id: gameId, seq: 0, time: Date.now()};
    await dbDaemon.put(token);
    const daemonToken = new DaemonToken(dbGame, token);

    // Set up the game
    const c = new Pouch('test');
    expect(await c.info()).toEqual(3);
  });
});
