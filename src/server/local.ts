
import {_Server, ServerError, ServerStagingResponse, ServerGameIdPrefixes} from './common';

import {_PbemSettings, _PbemState, _PbemAction, _GameHooks, PbemServerView} from '../game';

export type ServerStagingResponse<T> = ServerStagingResponse<T>;

export class GameInfo {
  phase: 'staging' | 'game' | 'end' = 'staging';
  settings?: _PbemSettings;
  state?: _PbemState;

  actionGroupInProgress: boolean = false;
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
      throw new ServerError.NoSuchGameError(gameId);
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
      throw new ServerError.NoSuchGameError(gameId);
    }

    if (gi.phase !== 'staging') {
      throw new ServerError.ServerError('Game already started');
    }

    gi.state = await _PbemState.create(settings);
    gi.phase = 'game';
    delete gi.settings;
  }


  async gameActions<Action extends _PbemAction>(gameId: string, actions: Action[]) {
    this._gameActions(gameId, actions);
  }


  async gameLoad<State extends _PbemState>(gameId: string) {
    const gi = this.games.get(gameId);
    if (gi === undefined) {
      throw new ServerError.NoSuchGameError(gameId);
    }

    if (gi.phase === 'staging') {
      throw new ServerError.GameIsStagingError(gameId);
    }

    return gi.state as State;
  }


  _gameActions<Action extends _PbemAction>(gameId: string, actions: Action[]) {
    const gi = this.games.get(gameId);
    if (gi === undefined) {
      throw new ServerError.ServerError('Bad game');
    }

    if (gi.phase !== 'game') {
      throw new ServerError.ServerError('In "game" phase only');
    }

    const state = gi.state!;
    const sinceAction = state.actions.length;
    const newGroup: boolean = !gi.actionGroupInProgress;
    let groupMember: boolean = gi.actionGroupInProgress;

    if (newGroup) {
      gi.actionGroupInProgress = true;
    }

    try {
      for (const action of actions) {
        const hooks = _PbemAction.resolve(action.type);
        if (hooks.validate !== undefined) {
          hooks.validate(state, action);
        }

        if (hooks.setupBackward !== undefined) {
          hooks.setupBackward(state, action);
        }

        action.actionGrouped = groupMember;
        state.actions.push(action);
        hooks.forward(state, action);

        groupMember = true;
      }

      if (newGroup) {
        // Only run hooks after other actions are resolved.
        const pbem = new ServerView(this, gameId, state);

        const gameHooks = _GameHooks.State;
        if (gameHooks !== undefined && gameHooks.triggerCheck !== undefined) {
          gameHooks.triggerCheck(pbem, sinceAction);
        }

        // May trigger PbemAction.RoundEnd, most notably.
        const pbemHooks = _PbemState.Hooks!;
        pbemHooks.triggerCheck!(pbem, sinceAction);
      }
    }
    catch (e) {
      if (!newGroup) {
        throw e;
      }
      console.error(e);

      while (state.actions.length > sinceAction) {
        const action = state.actions.pop()!;
        const hooks = _PbemAction.resolve(action.type);
        hooks.backward(state, action);
        if (hooks.validate !== undefined) {
          hooks.validate(state, action);
        }
        // TODO if validate fails here, game is corrupt.  Can we reload from
        // start of turn?  Only if we saved a copy.
      }
    }
    finally {
      if (newGroup) {
        gi.actionGroupInProgress = false;
      }
    }
  }
}

export const ServerLocal = new _ServerLocal();


export class ServerView implements PbemServerView<_PbemState> {
  playerId: number = -1;

  constructor(public _server: _ServerLocal, public _gameId: string,
      public state: Readonly<_PbemState>) {
  }

  action(type: string, ...args: any[]): void {
    this.actionMulti([type, ...args]);
  }


  actionMulti(...actions: Array<[string, ...any[]]>): void {
    const objs = [];
    for (const a of actions) {
      const act = _PbemAction.create(...a);
      act.playerOrigin = -1;
      objs.push(act);
    }
    this._server._gameActions(this._gameId, objs);
  }
}

