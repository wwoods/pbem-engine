
import createDebug from 'debug';
import {EventEmitter} from 'tsee';

import {ServerError} from './common';
import {DbGame, DbGameDoc, DbUserGameInvitationDoc, DbUserGameMembershipDoc,
  DbUser, DbUserId, DbUserActionDoc} from './db';
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
    // Called on server game daemon shutdown.
    delete: () => void;
  }>();

  get id() { return this._id; }

  _active: boolean = false;
  _activeInitialized?: Promise<void>;
  _activeInitialized_cb?: [any, any];
  _db: PouchDB.Database<DbGame>;
  _dbResolver: (userId: DbUserId) => PouchDB.Database<DbUser> | undefined;
  _debug: debug.Debugger;
  _host: DbUserId;
  _id: string;
  _localUser?: {id: string, activeId: string};
  // Foreign DB: [to, from].
  _replications = new Map<string, [PouchDB.FindContinuousCancel, PouchDB.FindContinuousCancel]>();
  _watcher?: GamePlayerWatcher;
  _watcherFind?: PouchDB.FindContinuousCancel;

  /** Note that `_dbResolver` may be called multiple times with the same user
   * database, and should return the same connection (or a pooled version)
   * wherever possible.
   * */
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
    this._activeInitialized = new Promise((resolve, reject) => {
      this._activeInitialized_cb = [resolve, reject];
    });

    this._debug('activated');

    (async () => {

      await this._handleSettingsCheck();

      this._watcherFind = this._db.findContinuous(
        {game: this._id},
        doc => {
          this._handleGameDoc(doc);
          const w = this._watcher;
          if (w !== undefined) w.triggerLoadOrChange(doc);
        },
        noMatch => {
          if (!noMatch) {
            this._activeInitialized_cb![0]();
          }
          else {
            this.deactivate();
            this._activeInitialized_cb![1](new ServerError.NoSuchGameError(
                this._id));
          }
        },
      );

    })().catch((e) => {
      this._debug(e);
      this.deactivate();
    });
  }

  /** Make this ServerGameDaemon inactive. */
  deactivate() {
    if (!this._active) return;
    this._debug('deactivating');
    (async () => {

      if (this._watcher !== undefined) {
        this._watcher.cancel();
        this._watcher = undefined;
      }

      if (this._watcherFind !== undefined) {
        this._watcherFind.cancel();
        this._watcherFind = undefined;
      }

      for (const r of this._replications.values()) {
        r[0].cancel();
        r[1].cancel();
      }
      this._replications.clear();

      this._active = false;

    })().catch(e => {
      this._debug(e);
    });
  }

  /** Handle any game-related document change that is not the game itself.
   * */
  _handleGameDoc(doc: DbGame) {
    (async () => {
      if (doc.type === 'game-data') {
        // Game data changed
        if (doc.ended && !doc.ending || doc._deleted) {
          this.deactivate();
          return;
        }

        if (doc.ending) {
          // replicate once to everyone, set ending to false.
          if (!doc.ended) {
            this._debug(`ended not set, but ending was?`);
          }

          let replications: number = 0;
          const cb = () => {
            replications -= 1;
            if (replications === 0) {
              (async () => {
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
              })().catch(this._debug);
            }
          };
          await this._activeInitialized;
          // All replications should have been set up in the initial
          // replication.
          for (const u of doc.settings.players) {
            if (u !== undefined &&
                u.dbId !== undefined && u.status === 'joined') {
              replications += 1;
              const userDb = await this._dbResolver(u.dbId);
              if (userDb === undefined) return;

              const r = this._db.replicate.to(userDb,
                {selector: {_id: {$eq: this._id}}});
              r.on('complete', cb);
            }
          }
        }
        else if (doc.phase === 'game') {
          const {docs} = await this._db.find({selector: {game: this._id,
            type: 'game-data-state'}});
          if (docs.length !== 0) {
            await this._watcherEnsureRunning();
            return;
          }

          // Create sentinel action.
          const actionFirst: DbUserActionDoc = {
            type: 'game-data-action',
            game: this._id,
            actions: [
              _PbemAction.create({
                type: 'PbemAction.RoundEnd',
                game: {},
              } as PbemAction.Types.RoundEnd),
            ],
          };
          const actionFirstResponse = await this._db.post(actionFirst);

          // TODO pass this state to the watcher.
          // NOTE - the _pbemWatcher plugin is NOT set at this point; if state
          // were to be preserved, that would need to happen.  Preferably in
          // an extensible manner.
          const state = await _PbemState.create(doc.settings);

          // Trick to get first PbemAction.RoundStart event to run triggers
          // as normal rounds - start with round 0 ended!
          state.roundEnded = true;

          await this._db.post({
            type: 'game-data-state',
            game: this._id,
            round: 0,
            state: this._saveState(state),
            actionPrev: actionFirstResponse.id,
          });
          await this._watcherEnsureRunning();
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
   *
   * TODO: should NOT change settings if game not in 'staging' state.
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
    await this._watcher!.init();
  }
};
