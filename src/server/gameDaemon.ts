
import createDebug from 'debug';
import {EventEmitter} from 'tsee';

import {ServerError} from './common';
import {DbGame, DbGameDoc, DbUserGameInvitationDoc, DbUserGameMembershipDoc,
  DbUser, DbUserId} from './db';
import PouchDb from './pouch';

import {PbemPlayer} from '../game';

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

      await this._handleSettingsCheck();

      let w: PouchDB.FindContinuousCancel;
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

  /** Handle any game-related document change that is not the game itself.
   * */
  _handleGameDoc(doc: DbGame) {
    (async () => {
      if (doc.type === 'game-data') {
        // Game data changed
        if (doc.phase === 'end' || doc._deleted) {
          this.deactivate();
          return;
        }

        if (doc.phase === 'ending') {
          // TODO - replicate once to everyone, change state to 'end'.
        }
      }
      else if (doc.type === 'game-invitation') {
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

        await this._handleUserResponseUpdate(doc.userId, userDb, doc);
        await this._handleSettingsCheck();
      }
      else if (doc.type === 'game-response-member') {
        // These documents are replicated to our database as a special case,
        // specifically to trigger this callback.  However, the latest
        // information regarding this document always lives in the remote
        // database.
        const userDb = await this._dbResolver(doc.userId);
        if (userDb === undefined) throw new ServerError.ServerError(
          `Could not find db for ${doc.userId.type} / ${doc.userId.id}`);

        await this._handleUserResponseUpdate(doc.userId, userDb, doc);
        await this._handleSettingsCheck();
      }
    })().catch(e => {
      this._debug(`Error for ${doc._id} / ${doc.type}: ${e}`);
    });
  }

  /** Poll game settings.  Poll game-membership and
   * game-invitation documents and validate that 'game-data' document has
   * players in slots.  Changes 'game-data' and invitations to be in parity,
   * with preference for respecting invitations.
   * */
  async _handleSettingsCheck() {
    const settings = await this._db.get(this._id) as DbGameDoc;

    const invites: DbUserGameInvitationDoc[] = (await this._db.find({selector: {
      type: 'game-invitation', game: this._id}})).docs as DbUserGameInvitationDoc[];
    const responsesDocs: DbUserGameMembershipDoc[] = (await this._db.find({selector: {
      type: 'game-response-member', game: this._id}})).docs as DbUserGameMembershipDoc[];

    let changed: boolean = false;

    // First source of truth: invites + host
    const playerToStr = (a: DbUserId|undefined) => (
      a === undefined ? 'bot' : `${a.type}--${a.id}`);
    const players = settings.settings.players.map(
      a => a !== undefined ? playerToStr(a.dbId) : undefined);
    const responses = new Map<string, string>();
    for (const d of responsesDocs) {
      responses.set(playerToStr(d.userId), d.status);
    }
    const slotsSeen = new Set<number>();

    /** Forcibly, but preferentially, add a player. */
    const addPlayer = async (player: PbemPlayer, canKick: boolean) => {
      const uidNoPlayer = players.indexOf(undefined);
      const uidBot = players.indexOf('bot');
      const uidLast = canKick ? players.length - 1 : -1;

      const uid = (
        uidNoPlayer !== -1 ? uidNoPlayer
        : uidBot !== -1 ? uidBot
        : uidLast);
      if (uid === -1) return -1;

      // TODO - poll local / remote name store.
      const name = player.dbId.id;
      player.name = name;

      changed = true;
      player.index = uid;
      settings.settings.players[uid] = player;
      return uid;
    };

    // # host
    if (['local', 'remote'].indexOf(settings.host.type) !== -1) {
      // Host must be a player
      const p = players.indexOf(playerToStr(settings.host));
      if (p !== -1) {
        slotsSeen.add(p);
      }
      else {
        const slot = await addPlayer({
          name: '<error>',
          status: 'joined',
          dbId: settings.host,
          playerSettings: {},
          index: -1,
        }, true);
        slotsSeen.add(slot);
      }
    }

    // # invites
    for (const i of invites) {
      const ps = playerToStr(i.userId);
      const p = players.indexOf(ps);
      const r = responses.get(ps);
      if (r !== undefined && r !== 'invited' && r !== 'joined') {
        // Negative response.  Kick them out!
        if (p !== -1) {
          changed = true;
          slotsSeen.add(p);
          delete settings.settings.players[p];
        }
      }
      else {
        // Should be in game, with following state
        const status = r === 'joined' ? 'joined' : 'invited';
        if (p === -1) {
          const uid = await addPlayer({
            name: '<error>',
            status: status,
            dbId: settings.host,
            playerSettings: {},
            index: -1,
          }, false);
          if (uid === -1) {
            // Delete this invite, I suppose.
            i._deleted = true;
            await this._db.put(i);
          }
          else {
            slotsSeen.add(uid);
          }
        }
        else {
          slotsSeen.add(p);
          const pp = settings.settings.players[p]!;
          if (pp.status !== status) {
            changed = true;
            pp.status = status;
          }
        }
      }
    }

    // Finally, any unseen slots were clearly uninvited
    const settingsPlayers = settings.settings.players;
    for (let i = 0, m = settingsPlayers.length; i < m; i++) {
      const p = settingsPlayers[i];
      if (p === undefined || slotsSeen.has(i)) continue;
      if (p.status === 'bot') continue;
      changed = true;
      delete settingsPlayers[i];
    }

    if (changed) {
      await this._db.put(settings);
    }
  }

  /** Arguments:
   * userId - ID of user whose response is being updated.
   * */
  async _handleUserResponseUpdate(userId: DbUserId, userDb: PouchDB.Database<DbUser>,
      docCause: DbUserGameMembershipDoc | DbUserGameInvitationDoc) {
    // Ignore any user response updates that match the host.
    if (this._host.type === userId.type && this._host.id === userId.id) {
      return;
    }

    if (docCause._deleted) {
      // find(), used below, will not return deleted docs.  So, stop whatever
      // replication we were doing, and keep this in mind.
      this._handleReplication(userDb, false);
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
        // Can ensure replication isn't ongoing (find() doesn't return deleted)
        if (!docCause._deleted) {
          throw new ServerError.ServerError("Should not trigger a no-invite, "
            + "no-response membership change without a deleted doc.");
        }
        return;
      }
      else if (!docCause._deleted || docCause.type !== 'game-response-member') {
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
        if (!docCause._deleted) {
          this._handleReplication(userDb, false);
        }
        
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
      const r = this._replications.get(uId);
      if (r !== undefined) {
        this._debug(`replication stop for ${uId}`);
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
    const memberSelector = {
      game: this._id,
      userId: {$eq: userId},
    };
    // Revoke their invitation locally, which will further terminate
    // replication.
    {
      const {docs} = await this._db.find({
        selector: {
          type: 'game-invitation',
          ...memberSelector,
        },
      });
      if (docs.length > 0) {
        for (const d of docs) {
          d._deleted = true;
        }
        await this._db.bulkDocs(docs);
      }
    }

    // Ensure their response is 'leaving', which will keep this behavior, and
    // regardless of replication, will inform them that they were kicked.
    {
      const {docs} = await userDb.find({
        selector: {
          type: 'game-response-member',
          ...memberSelector,
        },
      });
      if (docs.length > 0) {
        for (const d of docs) {
          d._deleted = true;
        }
        await userDb.bulkDocs(docs);
      }
    }

    // Also remove our artifact, now that replication should have stopped
    // (since the invitation was removed).
    {
      const {docs} = await this._db.find({
        selector: {
          type: 'game-response-member',
          ...memberSelector,
        },
      });
      if (docs.length > 0) {
        for (const d of docs) d._deleted = true;
        await this._db.bulkDocs(docs);
      }
    }
  }
};
