
import {EventEmitter} from 'tsee';
import util from 'util';

import {ServerError} from './common';
import {DbGame, DbGameDoc, DbUserGameInvitationDoc, DbUserGameMembershipDoc,
  DbUser, DbUserId, DbUserActionDoc, DbUserActionRequestDoc, DbGameStateDoc} from './db';
import {DaemonToken} from './gameDaemonController';
import {GamePlayerWatcher} from './gamePlayerWatcher';
import PouchDb from './pouch';

import {PbemPlayer, _PbemState, _PbemAction, PbemAction} from '../game';

/** Runs a game, from the DB point of view.
 *
 * Should do everything possible to maintain a valid state, even when faced
 * with errors.
 * */
export class ServerGameDaemon {
  events = new EventEmitter<{
    // Close when server game daemon closes gracefully for any reason.
    close: () => void;
    // Called on server game daemon shutdown due to game deletion.
    delete: () => void;
  }>();

  get id() { return this._id; }

  _active: boolean = false;
  _context: 'local' | 'remote';
  _creator!: DbUserId;
  _db: PouchDB.Database<DbGame>;
  _dbResolver: (dbName: string) => PouchDB.Database<DbUser> | undefined;
  _debug: {(v: any): void};
  _host!: DbUserId;
  _id: string;
  // DBs open for replicating to, or undefined, if game host != context.  That
  // is, a local context for a remote game is not responsible for replication.
  _replications: PouchDB.Database<DbUser>[] | undefined;
  _replicationsPlayers: {[key: string]: PouchDB.Database<DbUser>} | undefined;
  _token: DaemonToken;
  _watcher?: GamePlayerWatcher;

  /** Note that `_dbResolver` may be called multiple times with the same user
   * database, and should return the same connection (or a pooled version)
   * wherever possible.
   * */
  constructor(
    token: DaemonToken,
    db: PouchDB.Database<DbGame>,
    dbResolver: (dbName: string) => PouchDB.Database<DbUser> | undefined,
    context: 'local' | 'remote',
    gameId: string,
  ) {
    this._token = token;
    this._context = context;
    this._db = db;
    this._id = gameId;
    this._dbResolver = dbResolver;
    this._debug = this._token.debug.bind(this._token);

    this.activate();
  }

  /** Make this ServerGameDaemon active. */
  activate() {
    if (this._active) return;
    this._active = true;

    this._debug('activated');

    (async () => {
      // Ensure we're the right type of game, and that all invites/responses
      // for members are correct.
      await this._handleSettingsCheck();

      await this._token.changeProcess(
        {game: this._id},
        this._handleGameDoc.bind(this),
      );

    })().catch((e) => {
      this._debug(e);
      this.deactivate();
    });
  }

  /** Make this ServerGameDaemon inactive. */
  deactivate() {
    if (!this._active) return;
    this._token.defunct = true;
    this._debug('deactivating');
    (async () => {
      if (this._watcher !== undefined) {
        this._watcher.cancel();
        this._watcher = undefined;
      }
      
      this._active = false;

    })().catch(e => {
      this._debug(e);
    });
  }

  /** Handle any game-related document change that is not the game itself.
   * */
  async _handleGameDoc(doc: DbUser) {
    if (doc._deleted && ['game-response-action'].indexOf(doc.type) !== -1) {
      // Shortcut to avoid a few "await" calls.
      // ... but do replicate the deletion back to its source
      const i: number = (doc as DbUserActionRequestDoc).action.playerOrigin;
      this._debug(`Considering delete of ${doc._id} for ${i}`);
      if (this._replicationsPlayers !== undefined) {
        const rp = this._replicationsPlayers[i];
        if (rp !== undefined) {
          const repl = this._db.replicate.to(rp, {
            doc_ids: [doc._id!],
          });
          await repl;
        }
      }
      // Don't return here, as we want to forward the deletion to the
      // GameWatcher in case it needs to do something.
      //return;
    }
    
    this._debug(`handleDoc ${doc.type} / ${doc._id} -- ${this._watcher}`);
    await this._handleGameDocBeforeWatcher(doc);

    // Our watcher runs the game - it cannot miss a change.  To accomodate for
    // this, we run it after every non-aborted change.
    const w = this._watcher;
    if (w !== undefined) await w.triggerLoadOrChange(doc as DbGame);

    // If we're a replicating GameDaemon, ensure all clients received the
    // latest information before proceeding.
    if (this._replications !== undefined && doc.type.startsWith('game-data')) {
      await this._replicate(doc._id!);
    }
  }


  async _handleGameDocBeforeWatcher(doc: DbUser) {
    if (doc.type === 'game-data') {
      // Game data changed

      // Replicate to public game log, if remote (also replicate delete, ended,
      // etc).
      if (this._context === 'remote') {
        const dbListing = this._dbResolver('pbem-games');
        if (dbListing === undefined) throw new ServerError.ServerError("No pbem-games DB?");
        await this._db.replicate.to(dbListing, {
          doc_ids: [doc._id!],
        });
      }

      if (doc.ended && !doc.ending || doc._deleted) {
        this.deactivate();
        this.events.emit("delete");
        return;
      }

      if (doc.ending) {
        // replicate once to everyone, set ending to false.
        if (!doc.ended) {
          this._debug(`ended not set, but ending was?`);
        }

        if (this._replications === undefined) {
          // Not the replicating GameDaemon.
          return;
        }

        await this._replicate(doc._id!);

        if (this._db.dbName().startsWith('game')) {
          // Delete on ended - users have everything they need for replays.
          await this._db.destroy();
          this.deactivate();
          this.events.emit("delete");
          return;
        }

        // Unsetting 'ending' will deactivate ourselves and terminate
        // all replications.
        doc.ending = false;
        const bulk: any[] = [doc];
        if (doc.phase === 'staging') {
          doc._deleted = true;

          const {docs} = await this._db.find({selector: {
            game: this._id}});
          for (const d of docs) {
            if (d._id === doc._id) continue;
            d._deleted = true;
            bulk.push(d);
          }
        }
        await this._db.bulkDocs(bulk);
        return;
      }

      if (doc.initNeeded) {
        // Host invite + membership needs to be created.
        const invite: DbUserGameInvitationDoc = {
          _id: DbUserGameInvitationDoc.getId(this._id, doc.createdBy.id),
          type: 'game-invitation',
          game: this._id,
          userId: doc.createdBy,
        };

        try {
          await this._db.put(invite);
        }
        catch (e) {
          if (e.name !== 'conflict') throw e;
          // conflict means we've already done this step.
        }

        // Let the game-invitation listener handle the rest
        delete doc.initNeeded;
        await this._db.put(doc);
      }
      else {
        let hasHost = doc.createdBy === undefined;
        let hasPlayer = false;
        for (const p of doc.settings.players) {
          if (!p) continue;
          if (!p.dbId) continue;
          if (p.status !== 'joined' && p.status !== 'invited') continue;
          if (p.dbId.type === doc.createdBy.type && p.dbId.id === doc.createdBy.id) {
            hasHost = true;
          }
          hasPlayer = true;
          break;
        }
        if (!hasPlayer || !hasHost) {
          doc.ended = true;
          doc.ending = true;
          await this._db.put(doc);
          return;
        }
      }

      if (doc.phase === 'game') {
        {
          const {docs} = await this._db.find({selector: {game: this._id,
            type: 'game-data-state'}});
          if (docs.length !== 0) {
            // Initial state already open - don't worry if watcher is running or
            // not, as this change alone is not sufficient to warm it up.
            return;
          }
        }

        // NOTE - the _pbemWatcher plugin is NOT set at this point; if state
        // were to be preserved, that would need to happen.  Preferably in
        // an extensible manner.
        const state = await _PbemState.create(doc.settings);

        const stateFirst: DbGameStateDoc = {
          _id: DbGameStateDoc.getId(this._id, 0),
          type: 'game-data-state',
          game: this._id,
          round: 0,
          state: this._saveState(state),
          actionNext: 0,
        };
        await this._db.put(stateFirst);

        // The watcher MUST run for a minute, because on initialization it 
        // checks if the round is ended, and if so, it starts the next round.
        if (this._watcher === undefined) {
          await this._watcherEnsureRunning();
        }
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
      const userDb = await this._dbResolver(doc.userId.id);
      if (userDb === undefined) throw new ServerError.ServerError(
        `Could not find db for ${doc.userId.type} / ${doc.userId.id}`);

      // Check settings first, as that modifies game-data OR deletes the invite
      // if there's no room.
      await this._handleSettingsCheck();
      await this._handleUserResponseUpdate(doc.userId, userDb, doc);
    }
    else if (doc.type === 'game-response-action') {
      if (this._watcher === undefined) {
        await this._watcherEnsureRunning();
      }
    }
    else if (doc.type === 'game-response-member') {
      // These documents are replicated to our database as a special case,
      // specifically to trigger this callback.  However, the latest
      // information regarding this document always lives in the remote
      // database.
      const gameLocal = (this._host.type === 'local');
      const userLocal = (doc.userId.type === 'local');
      if (gameLocal !== userLocal) {
        throw new ServerError.ServerError(`User type does not match game`);
      }

      const userDb = await this._dbResolver(doc.userId.id);
      if (userDb === undefined) throw new ServerError.ServerError(
        `Could not find db for ${doc.userId.type} / ${doc.userId.id}`);

      await this._handleUserResponseUpdate(doc.userId, userDb, doc);
      await this._handleSettingsCheck();
    }
  }

  /** Poll game settings.  Poll game-membership and
   * game-invitation documents and validate that 'game-data' document has
   * players in slots.  Changes 'game-data' and invitations to be in parity,
   * with preference for respecting invitations.
   *
   * TODO: should NOT change settings if game not in 'staging' state.
   * */
  async _handleSettingsCheck() {
    let settings: DbGameDoc;
    try {
      settings = await this._db.get(this._id) as DbGameDoc;
    }
    catch (e) {
      if (e.name !== 'not_found') throw e;
      this.deactivate();
      return;
    }
    if (settings.type !== 'game-data') {
      throw new ServerError.ServerError(`Not a game?  ${settings.type}`);
    }

    this._creator = settings.createdBy;
    this._host = settings.host;
    this._replications = undefined;
    this._replicationsPlayers = undefined;

    if (settings.initNeeded) {
      // Cannot check settings until first initialization.
      return;
    }

    const contextIsLocal = this._context === 'local';
    const hostIsLocal = settings.host.type === 'local';
    if (contextIsLocal === hostIsLocal) {
      // Set up replications - we're in the right spot
      this._replications = [];
      this._replicationsPlayers = {};
      for (let i = 0, m = settings.settings.players.length; i < m; i++) {
        const u = settings.settings.players[i];
        if (!u) continue;

        const dbId = u.dbId as DbUserId | undefined;
        if (dbId === undefined) continue;

        const dbOther = this._dbResolver(dbId.id);
        if (dbOther === undefined) {
          throw new ServerError.ServerError("Bad user?");
        }
        this._replications.push(dbOther);
        this._replicationsPlayers[i] = dbOther;
      }
    }
    if (this._context === 'local') {
      if (settings.host.type !== 'local') {
        throw new ServerError.ServerError("Non-local game in local context?");
      }
    }
    else {
      if (settings.host.type === 'local') {
        throw new ServerError.ServerError("Local game in non-local context?");
      }
    }

    const invites: DbUserGameInvitationDoc[] = (await this._db.find({selector: {
      type: 'game-invitation', game: this._id}})).docs as DbUserGameInvitationDoc[];
    const responsesDocs: DbUserGameMembershipDoc[] = (await this._db.find({selector: {
      type: 'game-response-member', game: this._id}})).docs as DbUserGameMembershipDoc[];

    let changed: boolean = false;

    // First source of truth: invites + host
    const playerToStr = (a: DbUserId|undefined) => (
      a === undefined ? 'bot' : `${a.type}--${a.id}`);
    const players = settings.settings.players.map(
      a => a ? playerToStr(a.dbId) : undefined);
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
      let name = player.dbId.id;
      if (player.dbId.type !== 'local') {
        // remove 'pbem$'
        name = name.slice(5);
      }
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
        this._debug(`handleSettingsCheck: Adding host ${settings.host.id}`);
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
      if (r === undefined) {
        // _handleUserResponseUpdate() should handle this; let them pass for now
        if (p !== -1) {
          slotsSeen.add(p);
        }
        continue;
      }
      else if (r !== 'invited' && r !== 'joined') {
        // Negative response.  Kick them out!
        if (p !== -1) {
          changed = true;
          slotsSeen.delete(p);
          this._debug(`handleSettingsCheck: Membership leaving for ${i.userId.id}`);
          delete settings.settings.players[p];
        }
      }
      else {
        // Should be in game, with following state
        const status = r === 'joined' ? 'joined' : 'invited';
        if (p === -1) {
          this._debug(`handleSettingsCheck: confirmed response for ${i.userId.id}, adding to settings`);
          const uid = await addPlayer({
            name: '<error>',
            status: status,
            dbId: i.userId,
            playerSettings: {},
            index: -1,
          }, false);
          if (uid === -1) {
            // Delete this invite, I suppose.
            i._deleted = true;
            await this._db.put(i);
            this._debug(`handleSettingsCheck: Invite deleted for ${i.userId.id}, no room`);
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
      if (!p || slotsSeen.has(i)) continue;
      if (p.status === 'bot') continue;
      changed = true;
      this._debug(`handleSettingsCheck: No invite for slot ${i} / ${settingsPlayers[i]!.dbId!.id}`);
      delete settingsPlayers[i];
    }

    if (changed) {
      this._debug('handleSettingsCheck: changed');
      await this._db.put(settings);
    }
  }

  /** Arguments:
   * userId - ID of user whose response is being updated.
   * */
  async _handleUserResponseUpdate(userId: DbUserId, userDb: PouchDB.Database<DbUser>,
      docCause: DbUserGameMembershipDoc | DbUserGameInvitationDoc) {
    this._debug(`User response?`);
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
      type: 'game-response-member', 'userId.type': userId.type,
      'userId.id': userId.id, game: this._id}})).docs as DbUserGameMembershipDoc[];
    const invites = (await this._db.find({selector: {type: 'game-invitation',
      'userId.type': userId.type, 'userId.id': userId.id, game: this._id}})).docs as DbUserGameInvitationDoc[];
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
        const d = await this._db.get(this._id);
        const isCreator = (
          this._creator.type === userId.type && this._creator.id === userId.id);
        const respDoc: DbUserGameMembershipDoc = {
          _id: DbUserGameMembershipDoc.getId(this._id, userId.id),
          type: 'game-response-member',
          userId: userId,
          gameAddr: {
            host: this._host,
            id: this._id,
          },
          game: this._id,
          hostName: (d as DbGameDoc).hostName,
          status: this._host.type === 'local' || isCreator ? 'joined' : 'invited',
        };
        const resp = await userDb.post(respDoc);
        this._debug(`handleUserResponse: membership response created for ${userId.id}`);
      }
    }
    else {
      // There's a response; confirm OK by making sure invitation exists.
      if (invites.length === 0) {
        // No invitation - they should be rejected UNLESS this is a public, open
        // game, in which case an invitation may be created if the game is in
        // 'staging' state.
        const d = await this._db.get(this._id) as DbGameDoc;
        let allow = false;
        
        if (d.phase === 'staging' && !d.ended) {
          let hasSpace = false;
          for (const player of d.settings.players) {
            if (!player) {
              hasSpace = true;
              break;
            }
          }
          if (hasSpace) allow = true;
        }

        if (allow) {
          // Create an invitation - game settings will be updated in 
          // _handleSettingsCheck()
          this._debug(`handleUserResponse: creating invitation for ${userId.id}`);
          const invite: DbUserGameInvitationDoc = {
            _id: DbUserGameInvitationDoc.getId(this._id, userId.id),
            type: "game-invitation",
            game: this._id,
            userId: userId,
          };
          await this._db.put(invite);
        }
        else {
          if (!docCause._deleted) {
            // Already done if deleted
            this._handleReplication(userDb, false);
          }
          
          this._debug(`handleUserResponse: invite revoked for ${userId.id}`);
          for (const r of responses) {
            r._deleted = true;
          }
          await userDb.bulkDocs(responses);

          const dd = (await this._db.find({selector: {
            type: 'game-response-member', 'userId.type': userId.type, 'userId.id': userId.id,
            game: this._id}})).docs;
          for (const r of dd) {
            r._deleted = true;
          }
          await this._db.bulkDocs(dd);
        }
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
        // They've joined!  Replicate them up to date, then add them to sync list
        const p = new Promise((resolve, reject) => {
          const repl = this._db.replicate.to(userDb, {
            selector: {
              game: this._id,
              type: {$regex: 'game-data.*'},
            },
          });
          repl.on('complete', resolve);
          repl.on('error', reject);
        });
        await p;
        this._handleReplication(userDb, true);
      }
    }
  }

  _handleReplication(userDb: PouchDB.Database<DbUser>, enable: boolean) {
    if (this._replications === undefined) return;

    const uid = this._replications.indexOf(userDb);
    if (enable) {
      if (uid === -1) {
        this._replications.push(userDb);
      }
    }
    else {
      if (uid !== -1) {
        this._replications.splice(uid, 1);
      }
    }
  }

  /** ALWAYS called after _handleReplication().
   * */
  async _handleUserLeave(userId: DbUserId, userDb: PouchDB.Database<DbUser>) {
    const memberSelector = {
      game: this._id,
      'userId.type': userId.type,
      'userId.id': userId.id,
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


  async _replicate(docId: string) {
    if (this._replications === undefined) throw new ServerError.ServerError(
        "Not a replicating GameDaemon");
    
    const promises = [];
    for (const r of this._replications) {
      const p = new Promise((resolve, reject) => {
        const repl = this._db.replicate.to(r, {
          doc_ids: [docId],
        });
        repl.on('complete', resolve);
        repl.on('error', reject);
      });
      promises.push(p);
    }
    await Promise.all(promises);
  }


  _saveState(state: any) {
    const s = Object.assign({}, state);
    // Plugins do not serialize
    delete s.plugins;
    return s;
  }


  /** Watcher shouldn't run until game is in 'game' phase and there is a game
   * state.  So, there are a few places we might pick that up.
   * */
  async _watcherEnsureRunning() {
    if (this._watcher !== undefined) return;
    this._watcher = new GamePlayerWatcher(this._db, this._id, -1, {
      noContinuous: true});
    try {
      await this._watcher!.init();
    }
    catch (e) {
      this._watcher = undefined;
      throw e;
    }
  }
};
