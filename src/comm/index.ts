/**
 * Manages database comms for the client-side application.  That is:
 *
 * Application has many users, potentially.
 * Application has one active user.
 * The active user may start games for themselves, inviting other local users.
 * Accounts have an active / inactive state... allow PnP -> network -> PnP
 * trades.
 *
 * */
import assert from 'assert';
import axios from 'axios';

import PouchDb from '../server/pouch';

import {_GameHooks, _PbemAction, _PbemEvent, _PbemSettings, _PbemState, PbemDbId, PbemPlayer,
  PbemPlayerView, PbemAction, PbemActionWithDetails, PbemActionWithId, PbemEvent, 
  PbemState, _GameActionTypes} from '../game';
import {ServerError} from '../server/common';
export {ServerError} from '../server/common';
import {DbGame, DbGameDoc, DbUserGameInvitationDoc, DbUserGameMembershipDoc,
  DbUserId, DbUserIdsDoc, DbGameAddress} from '../server/db';
import {ServerGameDaemonController} from '../server/gameDaemonController';
import {GamePlayerWatcher} from '../server/gamePlayerWatcher';

import {DbLocal, DbLocalUserDefinition, DbLocalUsersDoc, DbUser} from './db';

/** Class responsible for handling DB communications for users.  Handles
 * communications with user database, and switching between users.  Primarily
 * handles local users, but sets up synchronization when needed.
 * */
export class _ServerLink {
  localPlayerActive(newPlayer?: number) {
    if (newPlayer !== undefined) {
      this._localPlayerActive = newPlayer;
      const p = this.localPlayers[newPlayer];
      const pg = this._localPlayerWatchers[newPlayer];
      this.localPlayerView.playerId = p.index;
      this.localPlayerView.state = pg.state;
      this.localPlayerView.uiEvents = [];
      this.localPlayerView._watcher = pg;
    }
    return this._localPlayerActive;
  }
  localPlayers: Array<PbemPlayer> = [];
  localPlayerView = new PlayerView<_PbemState, _PbemAction>();
  readyEvent = new Promise((resolve, reject) => {
    this._readyEvent = [resolve, reject];
  });


  // _local here refers to the locally-loaded game.
  _localGameDb?: PouchDB.Database<DbGame>;
  _localGameId?: string;
  _localPlayerActive: number = -1;
  _localPlayerWatchers: Array<GamePlayerWatcher> = [];

  _readyEvent!: [any, any];
  _dbLocal = new PouchDb<DbLocal>('pbem-local');
  _dbUserCurrent?: PouchDB.Database<DbUser>;
  _userCurrent?: DbLocalUserDefinition;
  _usersLocal: DbLocalUserDefinition[] = [];
  _dbUsersLoggedIn = new Map<string, PouchDB.Database<DbUser>>();
  _dbUsersRemoteSync = new Map<string, PouchDB.FindContinuousCancel>();
  // [Local user, local game] -> replication to other local user.
  _dbLocalReplications = new Map<string, Map<string, any>>();
  _$nextTick?: (cb: () => void) => void;

  get userCurrent(): Readonly<DbLocalUserDefinition> | undefined {
    return this._userCurrent;
  }

  async init() {
    let loginUser: string | undefined;
    this._dbLocal = new PouchDb<DbLocal>('pbem-local');
    this._dbLocal.setMaxListeners(100);
    await this._dbLocal.upsert('users', (doc: Partial<DbLocalUsersDoc>) => {
      doc.users = doc.users || [];
      loginUser = doc.userLoginLatestId;
      this._usersLocal = doc.users;
      return doc as DbLocalUsersDoc;
    });
    for (const u of this._usersLocal) {
      await this._dbUserLocalEnsureLoaded(u.localId, u.remoteToken, u.remoteId);
    }
    if (loginUser !== undefined) {
      await this.userLogin(loginUser);
    }
    this._readyEvent[0]();
  }

  /** Checks if two DbUserIds match.  Uses a list of local users since
   * their IDs can get squirrely. */
  dbIdMatches(i1: DbUserId, i2: DbUserId) {
    let iLocal: DbUserId, iOther: DbUserId;
    const userList = this._usersLocal;
    if (i1.type === 'system') {
      return i2.type === 'system' && i1.id === i2.id;
    }
    else if (i1.type === 'remote') {
      if (i2.type === 'remote') {
        return i1.id === i2.id;
      }
      else if (i2.type === 'system') return false;

      iLocal = i2;
      iOther = i1;
    }
    else {
      iLocal = i1;
      iOther = i2;
    }

    // iLocal is populated.  Identify it in the user list, and then try to
    // resolve iOther.
    if (iOther.type === 'system') return false;

    for (const u of userList) {
      for (const uid of u.localIdAll) {
        if (uid === iLocal.id) {
          // Presumably unique match
          if (iOther.type === 'remote') return u.remoteId === iOther.id;
          else if (iOther.type === 'local') return u.localIdAll.indexOf(
              iOther.id) !== -1;
          return false;
        }
      }
    }

    // Unable to make a determination; shouldn't happen ever.  Would mean that
    // e.g. a remote player is attempting to validate a player local to some
    // user other than themselves, which is madness.
    throw new ServerError.ServerError(`Could not resolve local ${iLocal.id}`);
  }

  /** Create and switch to local user `username`.
   * */
  async userCreate(username: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_ ]*/.test(username)) {
      throw new Error(`Username must start with a letter or number, and `
          + `then consist of letters, numbers, underscores, or spaces`);
    }

    // Generate a hopefully-globally-unique, local user ID.
    let userId: string = 'user' + this._dbLocal.getUuid();
    await this._dbLocal.upsert('users', (doc: Partial<DbLocalUsersDoc>) => {
      const users = this._usersLocal = doc.users!;
      if (users.map(x => x.localId).indexOf(userId) !== -1) {
        throw new Error(`User ID ${userId} in use?  Try again.`);
      }
      if (users.map(x => x.name).indexOf(username) >= 0) {
        throw new Error(`Username '${username}' already in use.`);
      }
      users.push({localId: userId, localIdAll: [userId], name: username});
      users.sort((a, b) => a.name.localeCompare(b.name));
      return doc as DbLocalUsersDoc;
    });

    return userId;
  }

  /** Switch to local user with specified local ID.
   * */
  async userLogin(userIdLocal: string) {
    const d = await this._dbLocal.get('users') as DbLocalUsersDoc;
    const u = d.users.filter(x => x.localId === userIdLocal);
    if (u.length !== 1) throw new Error('No such user?');

    // Set current user database
    await this._dbUserLocalEnsureLoaded(userIdLocal, u[0].remoteToken, 
        u[0].remoteId);
    this._dbUserCurrent = this._dbUsersLoggedIn.get(userIdLocal);
    this._userCurrent = u[0];
    await this._dbLocal.upsert('users', (doc: Partial<DbLocalUsersDoc>) => {
      doc.userLoginLatestId = userIdLocal;
      return doc as DbLocalUsersDoc;
    });
  }

  /** On successful login, user gets an API token for validating requests as
   * well as a connection string for this user's db.  Save those.
   * */
  async userCurrentSetLogin(token: string | undefined, db: string | undefined) {
    const users = (await this._dbLocal.get('users')) as DbLocalUsersDoc;
    if (users === undefined) throw new ServerError.ServerError("No users?");

    for (const d of users.users) {
      if (d.localId !== this._userCurrent!.localId) continue;
      d.remoteToken = token;
      if (db !== undefined) {
        d.remoteId = db;
      }
      // Save updated doc for cache
      this._userCurrent = d;
    }

    await this._dbLocal.put(users);
  }


  /** On registration, user gets a unique, permanent username. */
  async userCurrentSetRemote(userName: string | undefined) {
    const users = (await this._dbLocal.get('users')) as DbLocalUsersDoc;
    if (users === undefined) throw new ServerError.ServerError("No users?");

    for (const d of users.users) {
      if (d.localId !== this._userCurrent!.localId) continue;
      d.remoteName = userName;
      if (userName === undefined) {
        d.remoteId = undefined;
        d.remoteToken = undefined;
      }
      // Save updated doc for cache
      this._userCurrent = d;
    }

    await this._dbLocal.put(users);
  }

  /** List all local users.
   * */
  async userList() {
    await this.readyEvent;
    const d = await this._dbLocal.get('users') as DbLocalUsersDoc;
    return d.users;
  }


  /** Join a remote game. */
  async gameJoin(game: DbGameDoc): Promise<void> {
    const u = this.userCurrent!;
    if (u.remoteId === undefined) {
      throw new ServerError.ServerError('Not logged in');
    }

    const memberDoc: DbUserGameMembershipDoc = {
      _id: DbUserGameMembershipDoc.getId(game._id!, u.remoteId!),
      type: 'game-response-member',
      game: game._id!,
      gameAddr: {
        host: game.host,
        id: game._id!,
      },
      hostName: game.hostName,
      status: 'joined',
      userId: {
        type: 'remote',
        id: u.remoteId!,
      },
    };

    // Start looking for changes before putting document, to avoid race cond
    const p = new Promise((resolve, reject) => {
      // Our operation is over either when we get the DbGameDoc, or when the
      // game-repsonse-member we just created gets deleted.
      const c = this._dbUserCurrent!.changes({
        live: true,
        since: 'now',
        doc_ids: [memberDoc._id!, game._id!],
      });
      c.on('change', (info) => {
        if (info.id === memberDoc._id!) {
          if (info.deleted) {
            reject({message: 'Join was rejected'});
          }
          // Any other change shouldn't matter.
        }
        else {
          // Game doc, joined OK
          resolve();
        }
      });
      c.on('error', reject);
    });

    await this._dbUserCurrent!.put(memberDoc);

    await p;
  }


  async gameListMembership(): Promise<DbUserGameMembershipDoc[]> {
    await this._checkSynced();
    const {docs} = await this._dbUserCurrent!.find({selector: {
      type: 'game-response-member',
    }});
    let d = docs as DbUserGameMembershipDoc[];
    d = d.filter(a => this.userCurrentMatches(a.userId));
    return d;
  }


  async gameLoad<Settings extends _PbemSettings, State extends _PbemState,
      Action extends _PbemAction>(id: string): Promise<void> {
    if (this._localPlayerActive !== -1) {
      this.gameUnload();
    }
    await this._checkSynced();

    const docs = (await this._dbUserCurrent!.find({selector: {_id: {$eq: id}}})).docs as DbGameDoc[];
    if (docs.length === 0) {
      throw new ServerError.NoSuchGameError(id);
    }
    const game = docs[0];
    
    if (game.phase === 'staging') {
      throw new ServerError.GameIsStagingError(id);
    }

    this._localGameId = id;
    if (game.host.type === 'local') {
      // Run the game daemon locally
      for (const [u, db] of this._dbUsersLoggedIn.entries()) {
        const uId: DbUserId = {type: 'local', id: u};
        if (this.dbIdMatches(uId, game.host)) {
          this._localGameDb = db as PouchDB.Database<DbGame>;
          ServerGameDaemonController.runForDb(
              db, this._dbResolver.bind(this), 'local', game._id!);
          break;
        }
      }
    }
    this._localPlayerActive = 0;
    this._localPlayerWatchers = [];
    this.localPlayers = [];
    // Iterating in game order ensures first player will move first.
    for (let i = 0, m = game.settings.players.length; i < m; i++) {
      const p = game.settings.players[i];
      if (!p) continue;
      if (p.dbId === undefined) continue;

      for (const [u, db] of this._dbUsersLoggedIn.entries()) {
        const uId: DbUserId = {type: 'local', id: u};
        if (this.dbIdMatches(uId, p.dbId as DbUserId)) {
          this.localPlayers.push(p);
          this._localPlayerWatchers.push(new GamePlayerWatcher(
              db as PouchDB.Database<DbGame>, id, i));
        }
      }
    }

    // Before returning, ensure all watchers are initialized
    const promises: Promise<any>[] = [];
    for (const w of this._localPlayerWatchers) {
      promises.push(w.init());
      w.events.on('turnEnd', () => {
        const j = w.playerIdx;
        const active = this.localPlayerActive();
        if (this.localPlayers[active].index === j) {
          const n = (j + 1) % this.localPlayers.length;
          if (n !== active) {
            this.localPlayerActive(n);
          }
        }
      });
    }
    await Promise.all(promises);

    // Switch to first player without turn finished.
    let firstPlayer = 0;
    for (let i = 0, m = this._localPlayerWatchers.length; i < m; i++) {
      const w = this._localPlayerWatchers[i];
      if (!w.isTurnEnded) {
        firstPlayer = i;
        break;
      }
    }
    this.localPlayerActive(firstPlayer);
  }

  gameUnload() {
    if (this._localGameDb !== undefined) {
      ServerGameDaemonController.runForDbCancelLocal(this._localGameDb!,
          this._localGameId!);
      this._localGameDb = undefined;
    }
    this._localGameId = undefined;
    this._localPlayerActive = -1;
    for (const u of this._localPlayerWatchers) {
      u.cancel();
    }
    this._localPlayerWatchers = [];
  }

  async gameUndo(act: PbemActionWithDetails<_PbemAction>) {
    /*
    const comm = this._comm;
    if (comm === undefined) {
      throw new ServerError.ServerError('Bad comm');
    }

    await comm.gameUndo(act);*/
    throw new ServerError.ServerError('TODO');
  }

  getActivePlayerView<State extends _PbemState, Action extends _PbemAction>(nextTick: any): PlayerView<State, Action> | undefined {
    if (this.localPlayerActive() < 0) {
      return undefined;
    }
    this._$nextTick = nextTick;
    return this.localPlayerView as PlayerView<State, Action>;
  }

  /** Create the settings for a local game, in staging state.
   *
   * The current user is automatically player 1 to start.
   * */
  async stagingCreateLocal<Settings extends _PbemSettings>(init: {(s: Settings): Promise<void>}): Promise<string> {
    if (this._dbUserCurrent === undefined) throw new ServerError.ServerError(
        "No user logged in.");
    const s = _PbemSettings.create() as Settings;
    await init(s);

    // Populate player 1 with the current user.
    s.players[0] = {
      name: this.userCurrent!.name,
      status: 'joined',
      dbId: {
        type: 'local',
        id: this.userCurrent!.localId,
      },
      playerSettings: {},
      index: 0,
    };

    const gameHost = {
        type: 'local',
        // Use the specific local ID on this device.  Note that other devices
        // with this user's account will still be able to play this game,
        // thanks to the 'ids' document.
        id: this.userCurrent!.localId,
    } as DbUserId;

    // Create a stub document for _id / _rev.
    let gameDocResp: string;
    while (true) {
      gameDocResp = 'game' + this._dbUserCurrent.getUuid().substr(0, 8);
      try {
        await this._dbUserCurrent.get(gameDocResp);
      }
      catch (e) {
        if (e.name !== 'not_found') throw e;
        break;
      }
    }
    const gameDoc: DbGameDoc = {
      _id: gameDocResp,
      game: gameDocResp,
      type: 'game-data',
      host: gameHost,
      hostName: this._userCurrent!.name,
      createdBy: {
        type: 'local',
        id: this.userCurrent!.localId,
      },
      phase: 'staging',
      settings: s,
    };
    // The current user belongs to the new game.
    await this._dbUserCurrent.bulkDocs([
      gameDoc as any,
      {
        _id: DbUserGameMembershipDoc.getId(gameDoc._id!, gameHost.id),
        type: 'game-response-member',
        userId: gameHost,
        gameAddr: {
          host: gameHost,
          id: gameDoc._id!,
        },
        game: gameDoc._id!,
        hostName: gameDoc.hostName,
        status: 'joined',
      } as DbUserGameMembershipDoc,
    ]);
    return gameDoc._id!;
  }



  /** Create the settings for a remote, system-run game, in staging state.
   * 
   * We will be the host (have ability to dissolve the game).  Accomplished via
   * an API endpoint.
   * */
  async stagingCreateSystem(): Promise<string> {
    if (this._dbUserCurrent === undefined) throw new ServerError.ServerError(
        "No user logged in.");
    const token = this.userCurrent!.remoteToken;
    if (token === undefined) throw new ServerError.ServerError(
        "User not logged in with remote server.");

    const r = await axios.post('/pbem/createSystem', {}, {
      headers: {
        Authorization: `Bearer ${this.userCurrent!.remoteToken!}`,
      },
    });
    return r.data.id as string;
  }

  /** For the current user, load the giving game in 'staging' phase.
   * */
  async stagingLoad<Settings extends _PbemSettings>(id: string,
      callback: (arg: {host: PbemDbId, createdBy: PbemDbId, isLocal: boolean,
        isPastStaging: boolean, settings: Settings}) => void,
      callbackError: (error: Error) => void,
      ): Promise<PouchDB.FindContinuousCancel | undefined> {
    // Ensure that, if possible, we have the requisite game document.
    try {
      await this._checkSynced();
    }
    catch (e) {
      callbackError(e);
      return;
    }
    return this._dbUserCurrent!.findContinuous(
      {_id: {$eq: id}},
      d => {
        if (d.type !== 'game-data') throw new ServerError.ServerError(
            `Id not a game? ${id}`);
        callback({
          host: d.host as PbemDbId,
          createdBy: d.createdBy as PbemDbId,
          isLocal: d.host.type === 'local',
          isPastStaging: d.phase !== 'staging',
          settings: d.settings as Settings,
        });
      },
      noMatch => {
        if (noMatch) {
          callbackError(new ServerError.NoSuchGameError(id));
        }
      },
    );
  }

  /** Add a player to a game in staging. */
  async stagingPlayerAdd(gameId: string, slotIndex: number, playerId: DbUserId,
      playerName: string) {
    const d = await this._dbUserCurrent!.get(gameId) as DbGameDoc;
    if (d.type !== 'game-data') {
      throw new ServerError.ServerError(`Not a game doc? ${gameId}`);
    }

    if (d.phase !== 'staging') {
      throw new ServerError.ServerError(`Game not staging?`);
    }

    if (!this.userCurrentMatches(d.host)) {
      throw new ServerError.ServerError("Not host, cannot add player");
    }

    if (d.settings.players[slotIndex] !== undefined) {
      throw new ServerError.ServerError("Slot in use");
    }

    const userCurrentBestId = (
        this.userCurrent!.remoteId !== undefined
        ? {type: 'remote', id: this.userCurrent!.remoteId}
      : {type: 'local', id: this.userCurrent!.localId}) as DbUserId;

    d.settings.players[slotIndex] = {
      name: playerName,
      status: 'invited',
      dbId: playerId,
      playerSettings: {},
      index: slotIndex,
    };
    await this._dbUserCurrent!.bulkDocs([
      // Create the invitation block, which triggers the needed replications.
      {
        _id: DbUserGameInvitationDoc.getId(d._id!, playerId.id),
        type: 'game-invitation',
        game: d._id,
        userId: playerId,
      } as DbUserGameInvitationDoc,
      // Also update the game's cache
      d as any,
    ]);

    return d.settings;
  }

  /** Kick a player from a game in staging.
   *
   * Returns either new settings, without the kicked player, OR returns
   * undefined to signify that the player should be returned to the menu.
   * */
  async stagingPlayerKick(gameId: string, slotIndex: number) {
    // Make sure game is loaded
    const d = await this._dbUserCurrent!.get(gameId) as DbGameDoc;
    if (d.type !== 'game-data') {
      throw new ServerError.ServerError(`Not a game? ${gameId}`);
    }

    if (d.phase !== 'staging') {
      throw new ServerError.ServerError(`Can only kick from staging`);
    }

    // No player in that slot?  Nothing to kick.
    const p = d.settings.players[slotIndex];
    if (p === undefined) return d.settings;

    if (!this.userCurrentMatches(d.host)) {
      // If not the host, can only kick self.
      if (!this.userCurrentMatches(p!.dbId)) {
        throw new ServerError.ServerError("Cannot kick player if not host");
      }

      // Fetch own membership
      const dms = (await this._dbUserCurrent!.find({
        selector: {
          type: 'game-response-member',
          'game': d._id,
        },
      })).docs as Array<DbUserGameMembershipDoc>;

      // Update our membership, which should trickle to the appropriate
      // source.  A change listener on our own database will stop the
      // replication and delete the game data.
      for (const dm of dms) {
        dm.status = 'leaving';
      }
      await this._dbUserCurrent!.bulkDocs(dms);
      return undefined;
    }
    else {
      // Host can kick anyone; if they kick themselves, the game is dissolved.
      if (this.userCurrentMatches(p!.dbId)) {
        // Dissolve game; rely on the game watcher to do the dissolving.
        d.ending = true;
        d.ended = true;
        await this._dbUserCurrent!.put(d);
        return undefined;
      }
      else {
        // Dissolving their invitation should be sufficient.
        const dms = (await this._dbUserCurrent!.find({
          selector: {
            type: 'game-invitation',
            game: gameId,
            'userId.type': p!.dbId!.type,
            'userId.id': p!.dbId!.id,
          },
        })).docs;
        for (const dm of dms) {
          dm._deleted = true;
        }
        // Game settings will be overwritten by game daemon.
        //d.settings.players[slotIndex] = undefined;
        //dms.push(d as any);
        await this._dbUserCurrent!.bulkDocs(dms);
      }
    }
    return d.settings;
  }

  /** Take a game in staging and start it. */
  async stagingStartGame<Settings extends _PbemSettings>(gameId: string, settings: Settings): Promise<void> {
    // Ensure fully replicated first?  Or only valid for local games?
    const {docs} = await this._dbUserCurrent!.find({selector: {_id: {$eq: gameId}}});
    if (docs.length === 0) {
      throw new ServerError.NoSuchGameError(gameId);
    }

    let ddocs = (docs as DbGameDoc[]).filter(d => d.phase === 'staging');
    for (const d of ddocs) {
      d.phase = 'game';
      d.phaseChange = Date.now();
      // Validate settings prior to writing the phase change.
      _PbemSettings.Hooks.validate!(d.settings);
      const hooks = _GameHooks.Settings!;
      if (hooks.validate !== undefined) {
        hooks.validate(d.settings);
      }
    }
    // It's the game daemon that's responsible for generating the initial
    // state; simply moving the game to 'game' phase should be enough.
    await this._dbUserCurrent!.bulkDocs(ddocs);
  }

  userCurrentMatches(id: DbUserId) {
    const u = this.userCurrent;
    if (u === undefined) return false;

    const i = id as DbUserId;
    if (i.type === 'local') {
      for (const uid of u.localIdAll) {
        if (i.id === uid) return true;
      }
    }
    if (i.type === 'remote' && u.remoteId === i.id) return true;
    return false;
  }

  /** Block until the local user database is synchronized with the remote user
   * database, if applicable.
   * */
  async _checkSynced() {
    // TODO
    if (this._dbUserCurrent === undefined) {
      throw new ServerError.NotLoggedInError();
    }
  }

  _dbResolver(dbName: string) {
    for (const u of this._usersLocal) {
      if (u.localIdAll.indexOf(dbName) !== -1) {
        return this._dbUsersLoggedIn.get(u.localId);
      }
    }
    return undefined;
  }

  async _dbUserLocalEnsureLoaded(userIdLocal: string, userRemoteToken: string|undefined,
      userRemoteDb: string|undefined) {
    if (!this._dbUsersLoggedIn.has(userIdLocal)) {
      this._dbUsersLoggedIn.set(userIdLocal, new PouchDb<DbUser>(userIdLocal));

      // When we load a db, compact it, ensure indices exist
      const db = await this._dbUsersLoggedIn.get(userIdLocal)!;
      db.setMaxListeners(100);
      await db.compact();

      // Local synchronization code.  More fancy, since it requires watching
      // changes.
      let userIdsDoc: DbUserIdsDoc;
      try {
        userIdsDoc = await db.get('user-ids');
        // Ensure current ID is in list of localIds for this account.
        if (userIdsDoc.localIds.indexOf(userIdLocal) === -1) {
          userIdsDoc.localIds.push(userIdLocal);
          await db.put(userIdsDoc);
        }
      }
      catch (e) {
        if (e.name !== 'not_found') {
          throw e;
        }

        const d: DbUserIdsDoc = {
          _id: 'user-ids',
          type: 'user-ids',
          localIds: [userIdLocal],
          localIdActive: userIdLocal,
        };
        await db.put(d);
      }

      // Signal that this user db needs to be checked for changes.  Since local,
      // the service will not time out.
      ServerGameDaemonController.runForDb(db, this._dbResolver.bind(this),
          'local', undefined);
    }

    // Re-do remote sync, if applicable.
    {
      const sync = this._dbUsersRemoteSync.get(userIdLocal);
      if (sync !== undefined) {
        sync.cancel();
        this._dbUsersRemoteSync.delete(userIdLocal);
      }
    }
    if (userRemoteToken !== undefined && userRemoteDb !== undefined) {
      const noScheme = location.origin.split('//');
      const dbUrl = [noScheme[0], '//', userRemoteToken, '@', 
          noScheme.slice(1).join('//'), '/db/', userRemoteDb].join('');
      const sync = this._dbUsersLoggedIn.get(userIdLocal)!.sync(dbUrl, {
        live: true,
        retry: true,
      });
      this._dbUsersRemoteSync.set(userIdLocal, sync);
    }
    // TODO: remote sync code (only this user <-> remote user, nothing too
    // fancy).
  }
}



/** Note that for UI reactivity, all players share the same "PlayerView" object.
 * Only the properties get changed.
 * */
export class PlayerView<State extends _PbemState, Action extends _PbemAction> implements PbemPlayerView<State, Action> {
  // This class is exposed to end-user code, so "playerId" might be more
  // intuitive than just "id".
  playerId: number;
  state: State;
  uiEvents: Array<_PbemEvent>;
  // TODO: keep whether or not there is pending activity cached for the UI.
  _pending: boolean = false;
  _watcher!: GamePlayerWatcher;

  constructor() {
    this.playerId = -1;
    this.state = ({} as any) as State;
    this.uiEvents = [];
  }

  get hasPending(): boolean {
    return this._pending;
  }

  getRoundPlayerActions(): PbemActionWithId<Action>[] {
    return <PbemActionWithId<Action>[]>this._watcher.getRoundPlayerActions();
  }

  async action(action: Action) {
    //return this.actionMulti([type, ...args]);
    try {
      this.userActionErrorClear();
      return await this._watcher.action(action);
    }
    catch (e) {
      this.uiEvent('userError', PbemEvent.UserActionError, e);
    }
  }

  uiEvent<E extends PbemEvent._Type<T>, T>(eventId: string, eventType: E,
    game: T) {
    if (eventType.name === 'PbemEvent.UserActionError') {
      this.userActionErrorClear();
    }
    const event = PbemEvent.create(eventId, eventType, game);
    PbemEvent.queueRemoveIfExists(this.uiEvents, event.eventId);
    // Wait to enqueue the event until after any previously registered events
    // have been cleared.
    ServerLink._$nextTick!(() => {
      ServerLink._$nextTick!(() => {
        PbemEvent.queueAdd(this.uiEvents, event);
      });
    });
  }

  async undo(act: PbemActionWithId<_PbemAction>) {
    try {
      this.userActionErrorClear();
      return await this._watcher.undo(act);
    }
    catch (e) {
      this.uiEvent('userError', PbemEvent.UserActionError, e);
    }
  }

  /** Clear previous user action errors, since they did something else. */
  userActionErrorClear() {
    for (let i = this.uiEvents.length - 1; i > -1; --i) {
      if (this.uiEvents[i].type === 'PbemEvent.UserActionError') {
        this.uiEvents.splice(i, 1);
      }
    }
  }
}


export const ServerLink = new _ServerLink();

