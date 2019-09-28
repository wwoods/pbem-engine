
import assert from 'assert';

import {CommCommon} from './common';

import {_PbemSettings, _PbemState, _PbemAction, PbemActionWithDetails} from '../game';
import {ServerLocal, ServerStagingResponse} from '../server/local';

export class CommLocal implements CommCommon {
  gameId: string = '<bad>';

  _server = ServerLocal;

  async connect(gameId: string): Promise<void> {
    this.gameId = gameId;
    this._server = ServerLocal;
  }

  async close(): Promise<void> {
    //Nothing to do, all was stored locally.
  }

  async gameActions(actions: PbemActionWithDetails<_PbemAction>[]) {
    await this._server.gameActions(this.gameId, actions);
  }

  async gameUndo(action: PbemActionWithDetails<_PbemAction>) {
    await this._server.gameUndo(this.gameId, action);
  }

  async stagingCreate<Settings extends _PbemSettings>(s: Settings): Promise<void> {
    this.gameId = await this._server.stagingCreate(s);
  }

  async stagingLoad<Settings extends _PbemSettings>(): Promise<ServerStagingResponse<Settings>> {
    return await this._server.stagingLoad<Settings>(this.gameId);
  }

  async stagingStartGame<Settings extends _PbemSettings>(s: Settings): Promise<void> {
    assert(s.gameId === this.gameId);
    return await this._server.stagingStartGame(s);
  }

  async gameLoad<State extends _PbemState>(): Promise<State> {
    return await this._server.gameLoad<State>(this.gameId);
  }
}

