
import createDebug from 'debug';
import {EventEmitter} from 'tsee';

import {ServerError} from './common';
import {DbGame, DbGameDoc, DbUserGameInvitationDoc, DbUserGameMembershipDoc,
  DbUser, DbUserId} from './db';
import PouchDb from './pouch';

/** Runs a game, from the DB point of view.
 *
 * Should do everything possible to maintain a valid state, even when faced
 * with errors.
 * */
export class ServerGameDaemon {
  events = new EventEmitter<{
    // Called on server game daemon shutdown.
    delete: () => void;
  }>();

  get id() { return this._id; }

  _active: boolean = false;
  _db: PouchDB.Database<DbGame>;
  _dbResolver: (userId: DbUserId) => PouchDB.Database<DbUser> | undefined;
  _debug: debug.Debugger;
  _host: DbUserId;
  _id: string;
  _localUser?: {id: string, activeId: string};
  // Foreign DB: [to, from].
  _replications = new Map<string, [PouchDB.FindContinuousCancel, PouchDB.FindContinuousCancel]>();
  _watchers: PouchDB.FindContinuousCancel[] = [];

  constructor(
    db: PouchDB.Database<DbGame>,
    doc: DbGameDoc,
    options: {
      localId?: string,
      localActiveId?: string,
      dbResolver: (userId: DbUserId) => (PouchDB.Database<DbUser> | undefined),
    }
  ) {
    this._db = db;
    this._id = doc._id!;
    this._host = doc.host;
    this._dbResolver = options.dbResolver;
    this._debug = createDebug(`pbem-engine:game-${this._id}`);
    if (options.localId !== undefined) {
      this._localUser = {
        id: options.localId!,
        activeId: options.localActiveId!,
      };
    }

    if (doc.host.type !== 'local'
        || this._localUser !== undefined
          && doc.host.id === this._localUser.activeId) {
      this.activate();
    }
  }

  changeLocalActiveId(localActiveId: string) {
    if (this._localUser === undefined) return;

    this._localUser!.activeId = localActiveId;
    if (this._localUser!.activeId !== this._localUser!.id) {
      this.deactivate();
    }
    else {
      this.activate();
    }
  }

  /** Make this ServerGameDaemon active. */
  activate() {
    if (this._active) return;
    this._active = true;

    this._debug('activated');

    (async () => {

      let w: PouchDB.FindContinuousCancel;
      w = this._db.findContinuous({_id: {$eq: this._id}}, doc => {
        const d = doc as DbGameDoc;

        // Game data changed
        if (d.phase === 'end') {
          this.deactivate();
          return;
        }

        if (d.phase === 'ending') {
          // TODO - replicate once to everyone, change state to 'end'.
        }
      });
      this._watchers.push(w);

      w = this._db.findContinuous({game: this._id}, doc => {
        this._handleGameDoc(doc);
      });
      this._watchers.push(w);

    })().catch((e) => {
      this._debug(e.toString());
      this.deactivate();
    });
  }

  /** Make this ServerGameDaemon inactive. */
  deactivate() {
    if (!this._active) return;
    this._debug('deactivating');
    (async () => {

      for (const w of this._watchers) w.cancel();
      this._watchers = [];

      for (const r of this._replications.values()) {
        r[0].cancel();
        r[1].cancel();
      }
      this._replications.clear();

      this._active = false;

    })().catch(e => {
      this._debug(e.toString());
    });
  }

  /** Handle any game-related doucment change that is not the game itself.
   * */
  _handleGameDoc(doc: DbGame) {
    (async () => {
      if (doc.type === 'game-invitation') {
        const gameLocal = (this._host.type === 'local');
        const userLocal = (doc.userId.type === 'local');
        if (gameLocal !== userLocal) {
          throw new ServerError.ServerError(`User type does not match game`);
        }

        // Resolve the user database, make sure it exists, and find an
        // up-to-date response to the invitation.  The invitation is cached
        // locally, but replication cannot rely on that.
        const userDb = await this._dbResolver(doc.userId);
        if (userDb === undefined) throw new ServerError.ServerError(
          `Could not find db for ${doc.userId.type} / ${doc.userId.id}`);

        await this._handleUserResponseUpdate(doc.userId, userDb);
      }
      else if (doc.type === 'game-response-member') {
        // These documents are replicated to our database as a special case,
        // specifically to trigger this callback.  However, the latest
        // information regarding this document always lives in the remote
        // database.
        const userDb = await this._dbResolver(doc.userId);
        if (userDb === undefined) throw new ServerError.ServerError(
          `Could not find db for ${doc.userId.type} / ${doc.userId.id}`);

        await this._handleUserResponseUpdate(doc.userId, userDb);
      }
    })().catch(e => {
      this._debug(`Error for ${doc._id} / ${doc.type}: ${e}`);
    });
  }

  /** Arguments:
   * userId - ID of user whose response is being updated.
   * */
  async _handleUserResponseUpdate(userId: DbUserId, userDb: PouchDB.Database<DbUser>) {
    // Ignore any user response updates that match the host.
    if (this._host.type === userId.type && this._host.id === userId.id) {
      return;
    }

    // Any user response update requires information on both invitations and
    // responses.
    const responses = (await userDb.find({selector: {
      type: 'game-response-member', userId: {$eq: userId}, game: this._id}})).docs;
    const invites = (await this._db.find({selector: {type: 'game-invitation',
      'userId': {$eq: userId}, game: this._id}})).docs;
    // Note: db.find() does not return deleted documents.
    if (responses.length === 0) {
      // Invite this user, IF we can find a valid invitation.
      if (invites.length === 0) {
        // Nothing to do - no active response and no active invite.
        return;
      }
      else {
        // Go ahead with the invitation.
        await userDb.post({
          type: 'game-response-member',
          userId: userId,
          gameAddr: {
            host: this._host,
            id: this._id,
          },
          game: this._id,
          hostName: 'TODO',
          status: this._host.type === 'local' ? 'joined' : 'invited',
        });
      }
    }
    else {
      // There's a response; confirm OK by making sure invitation exists.
      if (invites.length === 0) {
        // No invitation - they should be rejected.
        for (const r of responses) {
          r._deleted = true;
        }
        await userDb.bulkDocs(responses);

        const dd = (await this._db.find({selector: {
          type: 'game-response-member', userId: {$eq: userId}, game: this._id}})).docs;
        for (const r of dd) {
          r._deleted = true;
        }
        await this._db.bulkDocs(dd);
        return;
      }
      
      const d = responses[0] as DbUserGameMembershipDoc;
      if (d.status !== 'joined' && d.status !== 'invited') {
        // Leaving; make sure we're not replicating them, and delete the
        // related documents.
        this._handleReplication(userDb, false);
        await this._handleUserLeave(userId, userDb);
      }
      else if (d.status === 'joined') {
        this._handleReplication(userDb, true);
      }
    }
  }

  _handleReplication(userDb: PouchDB.Database<DbUser>, enable: boolean) {
    // NOTE: this is NOT the userId!  This is the database name.
    const uId = userDb.name;
    if (uId === this._db.name) return;

    if (!enable) {
      this._debug(`replication stop for ${uId}`);
      const r = this._replications.get(uId);
      if (r !== undefined) {
        this._replications.delete(uId);
        for (const rr of r) rr.cancel();
      }
      return;
    }

    if (this._replications.has(uId)) return;

    this._debug(`replication start for ${uId}, from ${this._db.name}`);
    const back_off_function = (backoff: number) => {
      if (backoff === 0) return 100;
      return Math.min(60 * 1000, backoff * 2);
    };
    const r: [PouchDB.FindContinuousCancel, PouchDB.FindContinuousCancel] = [
      this._db.replicate.to(userDb, {
        selector: {
          game: this._id,
          type: {$regex: 'game-data.*'},
        },
        live: true,
        retry: true,
        back_off_function,
      }),
      this._db.replicate.from(userDb, {
        selector: {
          game: this._id,
          type: {$regex: 'game-response.*'},
        },
        live: true,
        retry: true,
        back_off_function,
      }),
    ];
    this._replications.set(uId, r);
  }

  /** ALWAYS called after _handleReplication().
   * */
  async _handleUserLeave(userId: DbUserId, userDb: PouchDB.Database<DbUser>) {
    // Ensure their response is deleted, which will keep this behavior, and
    // regardless of replication, will inform them that they were kicked.
    {
      const {docs} = await userDb.find({
        selector: {
          type: 'game-response-member',
          game: this._id,
          userId: userId,
        },
      });
      const ddocs = docs.filter(d => !d._deleted);
      if (ddocs.length > 0) {
        for (const d of ddocs) {
          d._deleted = true;
        }
        await userDb.bulkDocs(ddocs);
      }
    }

    // Revoke their invitation locally, which will further terminate
    // replication.
    {
      const {docs} = await this._db.find({
        selector: {
          type: {$in: ['game-response-member', 'game-invitation']},
          game: this._id,
          userId: userId,
        },
      });
      const ddocs = docs.filter(d => !d._deleted);
      if (ddocs.length > 0) {
        for (const d of ddocs) {
          d._deleted = true;
        }
        await this._db.bulkDocs(ddocs);
      }
    }
  }
}; TODO GET / FIND WILL NOT RETURN _DELETED, ONLY CHANGES WILL.
