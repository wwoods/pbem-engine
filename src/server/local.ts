
import {_Server, ServerStagingResponse, ServerGameIdPrefixes} from './common';

import {_PbemSettings, _PbemState} from '../game';

export type ServerStagingResponse<T> = ServerStagingResponse<T>;

export class GameInfo {
  phase: 'staging' | 'game' | 'end' = 'staging';
  settings?: _PbemSettings;
  state?: _PbemState;
}


export class _ServerLocal implements _Server {
  games = new Map<string, GameInfo>();
  async stagingCreate<Settings extends _PbemSettings>(settings: Settings): Promise<string> {
    const gi = new GameInfo();
    gi.settings = settings;

    if (settings.gameId !== undefined) {
      // Create / replace
      settings.gameId = ServerGameIdPrefixes.Local + settings.gameId;
      this.games.set(settings.gameId, gi);
    }
    else {
      throw new Error("Not implemented");
    }

    return settings.gameId;
  }

  async stagingLoad<Settings extends _PbemSettings>(gameId: string) {
    const gi = this.games.get(gameId);
    if (gi === undefined) {
      throw new Error('No such game');
    }

    return {
      isPastStaging: gi.phase !== 'staging',
      settings: gi.settings as Settings,
    };
  }


  async stagingStartGame<Settings extends _PbemSettings>(settings: Settings) {
    const gameId = settings.gameId;
    if (gameId === undefined) throw new Error('No gameId specified');

    const gi = this.games.get(gameId);
    if (gi === undefined) {
      throw new Error('No such game');
    }

    if (gi.phase !== 'staging') {
      throw new Error('Game already started');
    }

    gi.state = await _PbemState.create(settings);
    gi.phase = 'game';
    delete gi.settings;
  }


  async gameLoad<State extends _PbemState>(gameId: string) {
    const gi = this.games.get(gameId);
    if (gi === undefined) {
      throw new Error('No such game');
    }

    if (gi.phase === 'staging') {
      throw new Error('Game in staging.');
    }

    return gi.state as State;
  }
}

export const ServerLocal = new _ServerLocal();

