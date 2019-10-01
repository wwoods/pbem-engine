/**
 * Manages current user for the client-side application.  That is:
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

import {_PbemAction, _PbemEvent, _PbemSettings, _PbemState, PbemPlayer,
  PbemPlayerView, PbemAction, PbemActionWithDetails, PbemEvent, PbemState, _GameActionTypes} from '../game';
import {ServerError, ServerStagingResponse} from '../server/common';
export {ServerError} from '../server/common';
import {DbLocal, DbLocalUserDefinition, DbUser} from './db';

import {CommCommon} from './common';
import {IdPrefix, CommTypes} from './factory';

/** Note that for UI reactivity, all players share the same "PlayerView" object.
 * Only the properties get changed.
 * */
export class PlayerView<State extends _PbemState, Action extends _PbemAction> implements PbemPlayerView<State, Action> {
  // This class is exposed to end-user code, so "playerId" might be more
  // intuitive than just "id".
  playerId: number;
  state: State;
  uiEvents: Array<_PbemEvent>;

  constructor() {
    this.playerId = -1;
    this.state = ({} as any) as State;
    this.uiEvents = [];
  }

  get hasPending(): boolean {
    // states = [applied, pending, <redo>]
    return ServerLink.actionsPending.filter((x) => x.playerOrigin === this.playerId).length > 0;
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
  actionsPending: Array<PbemActionWithDetails<_PbemAction>> = [];
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

  _comm?: CommCommon;
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
    let loginUser: string | undefined;
    await this._dbLocal.upsert('users', (doc: Partial<DbLocal>) => {
      doc.users = doc.users || [];
      loginUser = doc.userLoginLatestId;
      return doc as DbLocal;
    });
    if (loginUser !== undefined) {
      await this.userLogin(loginUser);
    }
    this._readyEvent[0]();
  }

  /** Create and switch to local user `username`.
   * */
  async userCreate(username: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_ ]*/.test(username)) {
      throw new Error(`Username must start with a letter or number, and `
          + `then consist of letters, numbers, underscores, or spaces`);
    }

    let userId: string = "";
    await this._dbLocal.upsert('users', (doc: Partial<DbLocal>) => {
      const users = doc.users!;
      if (users.map(x => x.name).indexOf(username) >= 0) {
        throw new Error(`Username '${username}' already in use.`);
      }
      let id: number = 1;
      const ids = users.map(x => x.idLocal);
      while (ids.indexOf(id.toString()) >= 0) id++;
      userId = id.toString();
      users.push({idLocal: userId, name: username});
      users.sort((a, b) => a.name.localeCompare(b.name));
      return doc as DbLocal;
    });

    if (userId.length === 0) throw new Error("User ID not set?");
    await this.userLogin(userId);
  }

  /** Switch to local user `username`.
   * */
  async userLogin(userIdLocal: string) {
    const d = await this._dbLocal.get('users');
    const u = d.users.filter(x => x.idLocal === userIdLocal);
    if (u.length !== 1) throw new Error('No such user?');

    // Synchronize user, TODO

    // Set current user database
    if (this._dbUsersLoggedIn.has(userIdLocal)) {
      this._dbUsersLoggedIn.set(userIdLocal, new PouchDb<DbUser>(`user${userIdLocal}`));
      // TODO: sync code
    }
    this._dbUserCurrent = this._dbUsersLoggedIn.get(userIdLocal);
    this._userCurrent = u[0];
    await this._dbLocal.upsert('users', (doc: Partial<DbLocal>) => {
      doc.userLoginLatestId = userIdLocal;
      return doc as DbLocal;
    });
  }

  /** List all local users.
   * */
  async userList() {
    await this.readyEvent;
    const d = await this._dbLocal.get('users');
    return d.users;
  }

  /** Invoke the specified actions on the remote server. */
  async gameActions(action: PbemActionWithDetails<_PbemAction>[]) {
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
    }
  }


  async gameLoad<State extends _PbemState>(id: string): Promise<State> {
    await this._commSwitch(id);
    this._settings = undefined;
    this._state = await this._comm!.gameLoad<State>();
    // TODO smarter player management
    this.localPlayers = this._state.settings.players.filter(
        x => x !== undefined) as PbemPlayer[];
    this.localPlayerActive(0);
    return this._state! as State;
  }

  async gameUndo(act: PbemActionWithDetails<_PbemAction>) {
    const comm = this._comm;
    if (comm === undefined) {
      throw new ServerError.ServerError('Bad comm');
    }

    await comm.gameUndo(act);
  }

  async stagingCreateLocal<Settings extends _PbemSettings>(init: {(s: Settings): Promise<void>}): Promise<string> {
    const s = await this._stagingCreateSettings(init);

    await this._commSwitch(IdPrefix.Local);
    await this._comm!.stagingCreate(s);
    return this._comm!.gameId;
  }

  async stagingLoad<Settings extends _PbemSettings>(id: string): Promise<ServerStagingResponse<Settings>> {
    await this._commSwitch(id);
    const r = await this._comm!.stagingLoad<Settings>();
    if (r.settings !== undefined) {
      this._settings = r.settings;
      this._state = undefined;
    }
    return r;
  }

  async stagingStartGame<Settings extends _PbemSettings>(gameId: string, settings: Settings): Promise<void> {
    assert(gameId === settings.gameId);
    await this._commSwitch(gameId);
    return await this._comm!.stagingStartGame<Settings>(settings);
  }

  getActivePlayerView<State extends _PbemState, Action extends _PbemAction>(nextTick: any): PlayerView<State, Action> | undefined {
    if (this.localPlayerActive() < 0) {
      return undefined;
    }
    this._$nextTick = nextTick;
    return this.localPlayerView as PlayerView<State, Action>;
  }

  async _commSwitch(id: string): Promise<void> {
    if (this._comm !== undefined) {
      if (this._comm.gameId === id) return;

      this._comm.close();
      this._comm = undefined;
    }

    let newComm: any = undefined;
    for (const [type, value] of Object.entries(IdPrefix)) {
      if (id.startsWith(value)) {
        newComm = (CommTypes as any)[type];
      }
    }

    if (newComm === undefined) {
      throw new Error(`Not implemented: ${id}`);
    }

    this._comm = new newComm();
    try {
      await this._comm!.connect(id);
    }
    catch (e) {
      this._comm = undefined;
      throw e;
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

