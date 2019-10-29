/**
 * The global server, and each local device, may need to control GameDaemons 
 * running in multiple browser tabs / docker instances / whatever.  This class
 * deals with synchronizing the running of such daemons, as well as push-based
 * replication.
 * */

import createDebug from 'debug';

import { ServerError, sleep } from './common';
import { DbUser, DbGame, DbGameDoc } from './db';
import { ServerGameDaemon } from './gameDaemon';
import PouchDb from './pouch';


type DaemonStatus = {
  _id: string;
  _rev?: string;

  // Sequence number to which this daemon is up-to-date.
  seq: number;
};
namespace DaemonStatus {
  export function getId(dbName: string, gameId?: string) {
    if (gameId !== undefined) {
      return `${dbName}-g-${gameId}`;
    }
    return dbName;
  }
}

const heartbeat = 700;
const timeout = heartbeat * 2.5;
const backoff = 10;

const archiveGamesToKeep = 3;

// Regardless of local user device or full-powered server, keep a list of all
// possible daemons and where they're up-to-date.
const _daemons = new PouchDb('pbem-daemon');
// The pbem-daemon table is frequently updated, so compact it frequently.
setInterval(() => _daemons.compact(), 60 * 1000);

const _debug = createDebug('pbem-engine:ServerGameDaemonController');

const _localCancels: {[key: string]: boolean} = {};

export namespace ServerGameDaemonController {
  /** Start the Daemon corresponding to a certain activity - either a user's
   * local actions, their remote actions, or a specific game.
   * */
  export function runForDb(
      db: PouchDB.Database<DbUser>,
      dbResolver: (dbName: string) => PouchDB.Database<DbUser> | undefined,
      context: 'local' | 'remote',
      gameId: string | undefined,
      ) {
    _runForDb(db, dbResolver, context, gameId).catch(_debug);
  }


  /** Local context by default retries; this stops that. */
  export function runForDbCancelLocal(db: PouchDB.Database<DbUser>,
      gameId: string | undefined) {
    const id = DaemonStatus.getId(db.name, gameId);
    _localCancels[id] = true;
  }


  export async function _runForDb(
      db: PouchDB.Database<DbUser>,
      dbResolver: (dbName: string) => PouchDB.Database<DbUser> | undefined,
      context: 'local' | 'remote',
      gameId: string | undefined) {
    if (db.name.startsWith('game')) {
      gameId = db.name;
    }
    const id = DaemonStatus.getId(db.name, gameId);

    // Was explicitly requested; delete any pending cancels
    delete _localCancels[id];

    while (true) {
      const running = await _daemonToken(id, db);
      if (running !== undefined) {
        if (gameId !== undefined) {
          const p = new Promise((resolve, reject) => {
            const sgd = new ServerGameDaemon(running, db as PouchDB.Database<DbGame>, 
                dbResolver, context, gameId!);
            sgd.events.on("delete", () => {
              // Game was fully deleted, treat as a cancel.
              _localCancels[id] = true;
            });
          });
          await p;
        }
        else if (context === 'local' || context === 'remote') {
          await _runUser(running, context, db, dbResolver);
        }
        else {
          throw new ServerError.ServerError(`Not implemented: ${context}`);
        }
      }

      // Either it crashed, or we never had a token.

      // For non-local servers, the retry point sits in the server, watching
      // _global_changes.  So, don't retry non-local context.
      if (context !== 'local') return;

      // Also don't retry if the UI is no longer showing this game, even if it
      // is local.
      if (_localCancels[id] !== undefined) return;

      // For local, as long as the user keeps the tab/app open, we should be
      // ready to assume responsibility for actions.
      await sleep(timeout * backoff);
    }
  }


  async function _runUser(token: DaemonToken, context: 'local' | 'remote',
      db: PouchDB.Database<DbUser>,
      dbResolver: (dbName: string) => PouchDB.Database<DbUser> | undefined) {

    // These have two purposes:
    // 1. Push game-response-* updates to the DBs which need them.
    // 2. Start game watchers when updates are received for applicable games.

    const gameDbs: {[gameId: string]: PouchDB.Database<DbUser> | undefined} = {};
    const gameDbFetch = async (gameId: string) => {
      if (gameDbs.hasOwnProperty(gameId)) return gameDbs[gameId];

      const gameDoc = await db.get(gameId);
      if (gameDoc.type !== 'game-data') {
        throw new ServerError.ServerError(`Bad game ID? ${gameId}`);
      }

      if (gameDoc.host.type === 'local') {
        if (context !== 'local') return undefined;
      }
      else {
        if (context === 'local') return undefined;
      }
      const gdb = dbResolver(gameDoc.host.id);
      gameDbs[gameId] = gdb;
      return gdb;
    };
    const handle = async (doc: DbUser) => {
      // TODO how slow is one-by-one replication?
      // NOTE benefit of one-by-one replication: we're replicating in increasing
      // seq order, meaning sequential actions will be pushed in the right order
      if (doc.type === 'game-response-member') {
        if (doc._deleted) return;

        if (doc.gameAddr.host.type === 'local') {
          if (context !== 'local') {
            // Nothing to do - remote membership.
            return;
          }
        }
        else {
          if (context === 'local') {
            return;
          }
        }

        const gameDb = dbResolver(doc.gameAddr.host.id);
        if (gameDb === undefined) {
          // A local game, but not one on this device.  Cannot do much here.
          return;
        }

        gameDbs[doc.game] = gameDb;
        if (gameDb === db) {
          // This document is at its destination; spawn a ServerGameDaemon
          // to perform necessary replications / settings changes.
          runForDb(db, dbResolver, context, doc.game);
        }
        else {
          const p = new Promise((resolve, reject) => {
            const repl = db.replicate.to(gameDb, {
              doc_ids: [doc._id!],
            });
            repl.on('complete', () => {
              if (['invited', 'joined'].indexOf(doc.status) === -1) {
                // Want to delete this document as soon as it's been replicated.
                doc._deleted = true;
                db.put(doc);
              }
              resolve();
            });
            repl.on('error', reject);
          });
          await p;
        }
      }
      else if (doc.type === 'game-response-action') {
        if (doc._deleted) return;
        const gdb = await gameDbFetch(doc.game);
        if (gdb === undefined) {
          // Not local to this source; OK to ignore, I think.
          return;
        }
        if (db === gdb) {
          // This document is in its home.  In other words, this user is 
          // responsible for running the server.
          runForDb(db, dbResolver, context, doc.game);
          return;
        }

        const p = new Promise((resolve, reject) => {
          const repl = db.replicate.to(gdb, {
            doc_ids: [doc._id!],
          });
          repl.on('complete', resolve);
          repl.on('error', reject);
        });
        await p;
      }
      else if (doc.type === 'game-data') {
        // Update membership cached fields
        const mdoc = await db.find({
          selector: {
            game: doc._id!,
            type: 'game-response-member',
          },
        });
        for (const d of mdoc.docs) {
          if (d.type !== 'game-response-member') throw new ServerError.ServerError("Bad assertion");
          if (d.userId.type === context) {
            if (d.userId.id === db.name) {
              d.gamePhase = doc.phase;
              d.gameEnded = doc.ended;
              d.gamePhaseChange = doc.phaseChange;
              await db.put(d);
            }
          }
        }

        // TODO this doesn't handle "ending", meaning that a client will 
        // technically delete all game information earlier than necessary,
        // and a host will potentially delete this game before it's replicated.

        // See if older games need to be deleted.
        const games = (await db.find({
          selector: {
            type: 'game-data',
            ended: true,
          },
        })).docs as DbGameDoc[];
        const gg = games;
        gg.sort((a, b) => {
          if (a.phaseChange === undefined) return 1;
          if (b.phaseChange === undefined) return -1;
          return a.phaseChange - b.phaseChange;
        });
        while (gg.length > archiveGamesToKeep) {
          const gameDoc = gg.shift()!;
          while (true) {
            const toDelete = (await db.find({
              selector: {
                game: gameDoc._id!,
              },
              limit: 10,
            })).docs;

            const isLast = (toDelete.length < 10);
            for (let i = toDelete.length - 1; i > -1; i -= 1) {
              const d = toDelete[i];
              if (d.type === 'game-data' && !isLast) {
                // Delete this last.
                toDelete.splice(i, 1);
                continue;
              }
              d._deleted = true;
            }

            await db.bulkDocs(toDelete);
            if (isLast) break;
          }
        }
      }
    };

    // Note - the only times games need to update are responses?
    const selector = {
      type: {$in: ['game-data', 'game-response-action', 'game-response-member']},
    };
    await token.changeProcess(selector, handle);
  }


  async function _daemonToken(id: string, db: PouchDB.Database<DbUser>) {
    let token: DaemonStatus;
    try {
      token = await _daemons.get(id);
    }
    catch (e) {
      if (e.name !== 'not_found') throw e;
      token = {_id: id, seq: 0};
    }

    // Wait an amount of time s.t. a currently-running daemon would issue its
    // heartbeat.
    await sleep(timeout);
    try {
      const r = await _daemons.put(token);
      token._rev = r.rev;
    }
    catch (e) {
      if (e.name !== 'conflict') {
        throw e;
      }

      // Another service is running!
      return undefined;
    }

    // We're probably only service.
    const obj = new DaemonToken(db, token);
    return obj;
  }
}


export class DaemonToken {
  /** Debug logger */
  debug: debug.Debugger;

  /** Set to false to kill the daemon and relinquish the token. */
  defunct: boolean = false;

  /** ID of the token. */
  get id(): string { return this._token._id; }

  /** Read to get last update seq number; set to update with next heartbeat. */
  get seq() { return this._token.seq; }
  set seq(s: number) { this._token.seq = s; }

  /** Database which this daemon interacts with directly. */
  _db: PouchDB.Database<DbUser>;

  /** setInterval() response for heartbeat. */
  _heartbeatInterval: any;

  /** Currently-held token */
  _token: DaemonStatus;

  constructor(db: PouchDB.Database<DbUser>, tokenDoc: DaemonStatus) {
    this.debug = createDebug(`pbem-engine:d-${tokenDoc._id}`);
    this._db = db;
    this._token = tokenDoc;
    this.debug('started');

    this._heartbeatInterval = setInterval(async () => {
      if (this.defunct) {
        clearInterval(this._heartbeatInterval);
        this.debug('Stopped');
        return;
      }

      try {
        // Put latest seq handling information in database, and update 
        // heartbeat.
        const r = await _daemons.put(this._token);
        this._token._rev = r.rev;
      }
      catch (e) {
        if (e.name === 'conflict') {
          // Someone else got the winning revision.
          this.defunct = true;
          this.debug('Interrupted - conflict on put()');
        }

        this.debug(`Error: ${e}`);
      }
    }, heartbeat);
  }


  /** Core Daemon change-watching functionality. */
  async changeProcess(selector: PouchDB.Find.Selector, 
      handler: {(doc: DbUser): Promise<void>}) {

    // Doesn't seem like PouchDB supports async handlers here which defer
    // subsequent changes.  To prevent memory overload, stream changes 
    // initially, switching to 'live' only when done processing.
    const changesArgs = {
      include_docs: true,
      selector: selector,
    };

    while (true) {
      const changesStatic = Object.assign({}, changesArgs, {
        since: this.seq,
        limit: 5,
      });
      const changes = await this._db.changes(changesStatic);
      for (const r of changes.results) {
        if (this.defunct) return;

        await handler(r.doc!);
        // If we reach here, handled OK.
        this.seq = r.seq as number;
      }

      if (changes.results.length < changesStatic.limit) {
        // Was last batch!
        this.seq = changes.last_seq as number;
        break;
      }
    }

    // Up-to-date, go live
    const p = new Promise((resolve, reject) => {
      const changesLive = Object.assign({}, changesArgs, {
        live: true,
        since: this.seq,
      });
      const changes = this._db.changes(changesLive);
      changes.on('error', reject);

      // Again, keep async in order.
      const queue: PouchDB.Core.ChangesResponseChange<DbUser>[] = [];
      let queueRunning: boolean = false;
      changes.on('change', (info) => {
        queue.push(info);
        onQueue();
      });
      const onQueue = () => {
        if (queueRunning) return;
        queueRunning = true;
        onQueueStep().catch(this.debug);
      };
      const onQueueStep = async () => {
        const info = queue.shift();
        if (info === undefined) {
          queueRunning = false;
          return;
        }

        if (_localCancels[this.id]) {
          changes.cancel();
          this.defunct = true;
          resolve();
          return;
        }
        else if (this.defunct) {
          changes.cancel();
          resolve();
          return;
        }

        try {
          await handler(info.doc!);
          this.seq = info.seq as number;
        }
        catch (e) {
          this.defunct = true;
          throw e;
        }

        // Take another step
        onQueueStep().catch(this.debug);
      };
    });
    await p;
  }
}