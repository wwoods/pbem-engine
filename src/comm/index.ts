
import assert from 'assert';

import {_PbemAction, _PbemSettings, _PbemState, PbemPlayer, PbemPlayerView, PbemAction, PbemState, _GameActionTypes} from '../game';
import {ServerError, ServerStagingResponse} from '../server/common';
export {ServerError} from '../server/common';

import {CommCommon} from './common';
import {IdPrefix, CommTypes} from './factory';

/** Note that for UI reactivity, all players share the same "PlayerView" object.
 * Only the properties get changed.
 * */
export class PlayerView<State extends _PbemState> implements PbemPlayerView<State> {
  // This class is exposed to end-user code, so "playerId" might be more
  // intuitive than just "id".
  playerId: number;
  state: State;

  constructor() {
    this.playerId = -1;
    this.state = ({} as any) as State;
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

  async action(type: string, ...args: any[]) {
    //return this.actionMulti([type, ...args]);
    const act = _PbemAction.create(type, ...args);
    act.playerOrigin = this.playerId;
    await ServerLink.gameActions([act]);
  }

  async undo(act: _PbemAction) {
    await ServerLink.gameUndo(act);
  }
}


/** Class responsible for running local version of game and sending necessary
 * information to remote.
 * */
export class _ServerLink {
  actionsPending: Array<_PbemAction> = [];
  _localPlayerActive: number = -1;
  localPlayerActive(newPlayer?: number) {
    if (newPlayer !== undefined) {
      this._localPlayerActive = newPlayer;
      this.localPlayerView.playerId = newPlayer;
      this.localPlayerView.state = this._state!;
    }
    return this._localPlayerActive;
  }
  localPlayers: Array<PbemPlayer> = [];
  localPlayerView = new PlayerView<_PbemState>();

  _comm?: CommCommon;
  _settings?: _PbemSettings;
  _state?: _PbemState;

  async gameActions(action: _PbemAction[]) {
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
    this.localPlayers = this._state.settings.players;
    this.localPlayerActive(0);
    return this._state! as State;
  }

  async gameUndo(act: _PbemAction) {
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

  getActivePlayerView<State extends _PbemState>(): PlayerView<State> | undefined {
    if (this.localPlayerActive() < 0) {
      return undefined;
    }
    return this.localPlayerView as PlayerView<State>;
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
    return s;
  }
}


export const ServerLink = new _ServerLink();

