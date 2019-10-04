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

import PouchDb from 'pouchdb';
import PouchDbUpsert from 'pouchdb-upsert';
PouchDb.plugin(PouchDbUpsert);

import {_PbemAction, _PbemEvent, _PbemSettings, _PbemState, PbemDbId, PbemPlayer,
  PbemPlayerView, PbemAction, PbemActionWithDetails, PbemEvent, PbemState, _GameActionTypes} from '../game';
import {ServerError} from '../server/common';
export {ServerError} from '../server/common';
import {DbGameDoc, DbUserId} from '../server/db';
import {DbLocal, DbLocalUserDefinition, DbLocalUsersDoc, DbUser} from './db';

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

  constructor() {
    this.playerId = -1;
    this.state = ({} as any) as State;
    this.uiEvents = [];
  }

  get hasPending(): boolean {
    return this._pending;
  }

  getRoundPlayerActions() {
    const ra = PbemState.getRoundActions(this.state);
    const a = ra.filter(x => !x.actionGrouped && x.playerOrigin === this.playerId);
    return a;
  }

  async action(action: Action) {
    //return this.actionMulti([type, ...args]);
    try {
      this.userActionErrorClear();

      const act = _PbemAction.create(action);
      act.playerOrigin = this.playerId;
      await ServerLink.gameActions([act]);
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

  async undo(act: PbemActionWithDetails<_PbemAction>) {
    try {
      this.userActionErrorClear();

      await ServerLink.gameUndo(act);
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


/** Class responsible for running local version of game.  Handles
 * communications with user database, and switching between users.  Primarily
 * handles local users, but sets up synchronization when needed.
 * */
export class _ServerLink {
  _localPlayerActive: number = -1;
  localPlayerActive(newPlayer?: number) {
    if (newPlayer !== undefined) {
      this._localPlayerActive = newPlayer;
      this.localPlayerView.playerId = this.localPlayers[newPlayer].index;
      this.localPlayerView.state = this._state!;
      this.localPlayerView.uiEvents = [];
    }
    return this._localPlayerActive;
  }
  localPlayers: Array<PbemPlayer> = [];
  localPlayerView = new PlayerView<_PbemState, _PbemAction>();
  readyEvent = new Promise((resolve, reject) => {
    this._readyEvent = [resolve, reject];
  });

  _readyEvent!: [any, any];
  _settings?: _PbemSettings;
  _state?: _PbemState;
  _dbLocal = new PouchDb<DbLocal>('pbem-local');
  _dbUserCurrent?: PouchDB.Database<DbUser>;
  _userCurrent?: DbLocalUserDefinition;
  _dbUsersLoggedIn = new Map<string, PouchDB.Database<DbUser>>();
  _$nextTick?: (cb: () => void) => void;

  get userCurrent(): Readonly<DbLocalUserDefinition> | undefined {
    return this._userCurrent;
  }

  async init() {
    let localUsers: DbLocalUserDefinition[] = [];
    let loginUser: string | undefined;
    await this._dbLocal.upsert('users', (doc: Partial<DbLocalUsersDoc>) => {
      doc.users = doc.users || [];
      loginUser = doc.userLoginLatestId;
      localUsers = doc.users;
      return doc as DbLocalUsersDoc;
    });
    for (const u of localUsers) {
      await this._dbUserLocalEnsureLoaded(u.localId);
    }
    if (loginUser !== undefined) {
      await this.userLogin(loginUser);
    }
    this._readyEvent[0]();
  }

  /** Checks if two DbUserIds match.  Requires a list of local users since
   * their IDs can get squirrely. */
  dbIdMatches(i1: DbUserId, i2: DbUserId, userList: Array<DbLocalUserDefinition>) {
    let iLocal: DbUserId, iOther: DbUserId;
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
    throw new ServerError.ServerError(`Could not resolved ${iLocal}`);
  }

  /** Create and switch to local user `username`.
   * */
  async userCreate(username: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_ ]*/.test(username)) {
      throw new Error(`Username must start with a letter or number, and `
          + `then consist of letters, numbers, underscores, or spaces`);
    }

    // Generate a hopefully-globally-unique, local user ID.
    const userPlaceholder = await this._dbLocal.post({
        type: 'user-local-placeholder'});
    let userId: string = userPlaceholder.id;
    await this._dbLocal.upsert('users', (doc: Partial<DbLocalUsersDoc>) => {
      const users = doc.users!;
      if (users.map(x => x.name).indexOf(username) >= 0) {
        throw new Error(`Username '${username}' already in use.`);
      }
      users.push({localId: userId, localIdAll: [userId], name: username});
      users.sort((a, b) => a.name.localeCompare(b.name));
      return doc as DbLocalUsersDoc;
    });

    await this.userLogin(userId);
  }

  /** Switch to local user with specified local ID.
   * */
  async userLogin(userIdLocal: string) {
    const d = await this._dbLocal.get('users') as DbLocalUsersDoc;
    const u = d.users.filter(x => x.localId === userIdLocal);
    if (u.length !== 1) throw new Error('No such user?');

    // Set current user database
    await this._dbUserLocalEnsureLoaded(userIdLocal);
    this._dbUserCurrent = this._dbUsersLoggedIn.get(userIdLocal);
    this._userCurrent = u[0];
    await this._dbLocal.upsert('users', (doc: Partial<DbLocalUsersDoc>) => {
      doc.userLoginLatestId = userIdLocal;
      return doc as DbLocalUsersDoc;
    });
  }

  /** List all local users.
   * */
  async userList() {
    await this.readyEvent;
    const d = await this._dbLocal.get('users') as DbLocalUsersDoc;
    return d.users;
  }

  /** Invoke the specified actions on the remote server. */
  async gameActions(action: PbemActionWithDetails<_PbemAction>[]) {
    /*
    const comm = this._comm;
    if (comm === undefined) {
      throw new ServerError.ServerError('Bad comm');
    }
    const s = this._state!;
    const before = s.actions.length;

    assert(comm.gameId !== undefined);
    await comm.gameActions(action);

    const roundStarted = s.actions.slice(before).filter((x) => x.type === 'PbemAction.RoundStart').length > 0;
    if (roundStarted) {
      this.localPlayerActive(0);
    }
    else if (s.turnEnded[this.localPlayerView.playerId]) {
      this.localPlayerActive(
          (this.localPlayerActive() + 1) % this.localPlayers.length);
    }*/
    throw new ServerError.ServerError('TODO');
  }


  async gameLoad<State extends _PbemState>(id: string): Promise<State> {
    /*
    await this._commSwitch(id);
    this._settings = undefined;
    this._state = await this._comm!.gameLoad<State>();
    // TODO smarter player management
    this.localPlayers = this._state.settings.players.filter(
        x => x !== undefined) as PbemPlayer[];
    this.localPlayerActive(0);*/
    throw new ServerError.ServerError('TODO');
    return this._state! as State;
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

  /** Create the settings for a local game, in staging state.
   *
   * The current user is automatically player 1, which should be locked (TODO).
   * */
  async stagingCreateLocal<Settings extends _PbemSettings>(init: {(s: Settings): Promise<void>}): Promise<string> {
    if (this._dbUserCurrent === undefined) throw new ServerError.ServerError(
        "No user logged in.");
    const s = await this._stagingCreateSettings(init);

    // Populate player 1 with the current user.
    s.players[0] = {
      name: this.userCurrent!.name,
      status: 'normal',
      dbId: {
        type: 'local',
        id: this.userCurrent!.localId,
      },
      playerSettings: {},
      index: 0,
    };

    const gameDoc = await this._dbUserCurrent.post({
      type: 'game',
      host: {
        type: 'local',
        // Use the specific local ID on this device.  Note that other devices
        // with this user's account will still be able to play this game,
        // thanks to the 'ids' document.
        id: this.userCurrent!.localId,
      },
      createdBy: {
        type: 'local',
        id: this.userCurrent!.localId,
      },
      phase: 'staging',
      settings: s,
    });
    // The current user belongs to the new game.
    await this._dbUserCurrent.post({
      type: 'game-member',
      gameAddr: {
        host: {
          type: 'local',
          id: this.userCurrent!.localId,
        },
        id: gameDoc.id,
      },
    });
    return gameDoc.id;
  }

  /** For the current user, load the giving game in 'staging' phase.
   * */
  async stagingLoad<Settings extends _PbemSettings>(id: string): Promise<{
      host: PbemDbId,
      isPastStaging: boolean,
      settings: Settings,
  }> {
    // Ensure that, if possible, we have the requisite game document.
    await this._checkSynced();
    const d = await this._dbUserCurrent!.get(id);
    if (d.type !== 'game') throw new ServerError.ServerError(`Id not a game? ${id}`);
    return {
      host: d.host as PbemDbId,
      isPastStaging: d.phase !== 'staging',
      settings: d.settings as Settings,
    };
  }

  /** Add a player to a game in staging. */
  async stagingPlayerAdd(gameId: string, slotIndex: number, playerId: DbUserId,
    playerName: string) {
    const d = await this._dbUserCurrent!.get(gameId) as DbGameDoc;
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

    if (playerId.type === 'local') {
      d.settings.players[slotIndex] = {
          name: playerName,
          status: 'normal',
          dbId: playerId,
          playerSettings: {},
          index: slotIndex,
      };
      const dbOther = this._dbUsersLoggedIn.get(playerId.id);
      if (dbOther === undefined) throw new ServerError.ServerError(
          "Specified local user not actually local?");
      await dbOther.post({
        type: 'game-member',
        gameAddr: {
          host: userCurrentBestId,
          id: gameId,
        },
      });
    }
    else if (playerId.type === 'remote') {
      throw new ServerError.ServerError("Not implemented.  Need to "
          + "reserve slot, and create a document which will be replicated "
          + "to the remote user's repository.");
    }
    else {
      throw new ServerError.ServerError(
          `Non-local or remote playerId? ${playerId.type}`);
    }

    await this._dbUserCurrent!.put(d);
    return d.settings;
  }

  /** Kick a player from a game in staging.  */
  async stagingPlayerKick(gameId: string, slotIndex: number) {
  }

  /** Take a game in staging and start it. */
  async stagingStartGame<Settings extends _PbemSettings>(gameId: string, settings: Settings): Promise<void> {
    /*assert(gameId === settings.gameId);
    await this._commSwitch(gameId);
    return await this._comm!.stagingStartGame<Settings>(settings);*/
    throw new ServerError.ServerError('TODO');
  }

  userCurrentMatches(id: DbUserId) {
    const u = this.userCurrent;
    if (u === undefined) return false;

    const i = id as DbUserId;
    // TODO make this work with all user local IDs; we may be on a different
    // device.
    if (i.type === 'local' && u.localId === i.id) return true;
    if (i.type === 'remote' && u.remoteId === i.id) return true;
    return false;
  }

  getActivePlayerView<State extends _PbemState, Action extends _PbemAction>(nextTick: any): PlayerView<State, Action> | undefined {
    if (this.localPlayerActive() < 0) {
      return undefined;
    }
    this._$nextTick = nextTick;
    return this.localPlayerView as PlayerView<State, Action>;
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

  async _dbUserLocalEnsureLoaded(userIdLocal: string) {
    if (!this._dbUsersLoggedIn.has(userIdLocal)) {
      this._dbUsersLoggedIn.set(userIdLocal, new PouchDb<DbUser>(`user${userIdLocal}`));
      // TODO: remote sync code

      await this._dbUsersLoggedIn.get(userIdLocal)!.compact();
    }
  }

  async _stagingCreateSettings<Settings extends _PbemSettings>(init: {(s: Settings): Promise<void>}): Promise<Settings> {
    const s = _PbemSettings.create() as Settings;
    _PbemSettings.Hooks.init(s);
    await init(s);
    // After all hooks, ensure players.length is valid
    if (s.playersValid.indexOf(s.players.length) === -1) {
      s.players.length = s.playersValid[0];
    }
    return s;
  }
}


export const ServerLink = new _ServerLink();

