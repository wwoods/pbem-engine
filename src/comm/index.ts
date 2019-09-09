
import assert from 'assert';

import {_PbemAction, _PbemSettings, _PbemState, PbemPlayerView} from '../game';
import {ServerError, ServerStagingResponse} from '../server/common';

import {CommCommon} from './common';
import {IdPrefix, CommTypes} from './factory';

export {ServerError} from '../server/common';

export class PlayerView<State extends _PbemState> implements PbemPlayerView<State> {
  // This class is exposed to end-user code, so "playerId" might be more
  // intuitive than just "id".
  playerId: number;
  state: State;

  constructor(id: number, state: State) {
    this.playerId = id;
    this.state = state;
  }

  get hasPending(): boolean {
    // states = [applied, pending, <redo>]
    return ServerLink.actionsPending.filter((x) => x.playerOrigin === this.playerId).length > 0;
  }

  async action(type: string, ...args: any[]) {
  }

  async actionMulti(...actions: Array<[string, ...any[]]>) {
  }
}


/** Class responsible for running local version of game and sending necessary
 * information to remote.
 * */
export class _ServerLink {
  actionsPending: Array<_PbemAction> = [];
  playerActive: number = -1;
  playerViews: Array<PlayerView<_PbemState>> = [];

  _comm?: CommCommon;
  _settings?: _PbemSettings;
  _state?: _PbemState;

  async gameLoad<State extends _PbemState>(id: string): Promise<State> {
    await this._commSwitch(id);
    this._settings = undefined;
    this._state = await this._comm!.gameLoad<State>();
    // TODO smarter player management
    this.playerActive = 0;
    for (let i = 0; i < 2; i++) {
      this.playerViews.push(new PlayerView<_PbemState>(i, this._state));
    }
    return this._state! as State;
  }

  async stagingCreateLocal<Settings extends _PbemSettings>(init?: {(s: Settings): Promise<void>}): Promise<string> {
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
    if (this.playerActive < 0) {
      return undefined;
    }
    return this.playerViews[this.playerActive] as PlayerView<State>;
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


  async _stagingCreateSettings<Settings extends _PbemSettings>(init?: {(s: Settings): Promise<void>}): Promise<Settings> {
    const s = await _PbemSettings.create() as Settings;
    await _PbemSettings.Hooks.pbemInit(s);
    init !== undefined && await init(s);
    return s;
  }
}


export const ServerLink = new _ServerLink();

