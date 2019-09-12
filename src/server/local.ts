
import {_Server, ServerError, ServerStagingResponse, ServerGameIdPrefixes} from './common';

import {_PbemSettings, _PbemState, _PbemAction, _GameHooks, PbemError,
  PbemServerView} from '../game';

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

    // Validate
    _PbemSettings.Hooks.validate!(settings);
    const hooks = _GameHooks.Settings!;
    if (hooks.validate !== undefined) {
      hooks.validate(settings);
    }

    // Start
    gi.state = await _PbemState.create(settings);
    gi.phase = 'game';
    delete gi.settings;
  }


  async gameActions<Action extends _PbemAction>(gameId: string, actions: Action[]) {
    this._gameActions(gameId, actions);
  }


  async gameLoad<State extends _PbemState>(gameId: string) {
    const gi = this._fetchGame(gameId);
    return gi.state as State;
  }

  async gameUndo(gameId: string, action: _PbemAction) {
    const gi = this._fetchGame(gameId);
    const state = gi.state!;
    const acts = state.actions;
    // Most undo will be recent actions, so start there.
    let m = acts.length, i = m;
    while (i > 0) {
      --i;
      const a = acts[i];
      // Cannot undo before the round start or before end of game
      if (a.type === 'PbemAction.GameEnd' || a.type === 'PbemAction.RoundStart') break;
      if (a.actionId !== action.actionId) continue;
      if (a.actionGrouped) throw new PbemError("Cannot undo grouped action");

      //This is the action to roll back.
      let j = i + 1;
      while (j < m && acts[j].actionGrouped) j++;

      const rolled = [];
      try {
        let k = j;
        while (k > i) {
          --k;

          const ak = acts[k];
          const hooks = _PbemAction.resolve(ak.type);
          if (hooks.validateBackward) hooks.validateBackward(state, ak);
          hooks.backward(state, ak);
          rolled.push(ak);
          acts.splice(k, 1);
          if (hooks.validate) hooks.validate(state, ak);
        }

        // All OK
      }
      catch (e) {
        let k = j - rolled.length;
        for (const r of rolled) {
          const hooks = _PbemAction.resolve(r.type);
          hooks.forward(state, r);
          acts.splice(k, 0, r);
          k++;
        }
        throw e;
      }

      return;
    }

    throw new PbemError("Couldn't find action");
  }


  _fetchGame(gameId: string) {
    const gi = this.games.get(gameId);
    if (gi === undefined) {
      throw new ServerError.NoSuchGameError(gameId);
    }

    if (gi.phase === 'staging') {
      throw new ServerError.GameIsStagingError(gameId);
    }
    return gi;
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
        if (state.gameEnded) throw new PbemError('Game already over');

        if (action.playerOrigin === -1) {
          // System always OK at this point.
        }
        else {
          if (action.playerOrigin < 0 || action.playerOrigin >= state.settings.players.length) {
            throw new PbemError(`Bad player index: ${action.playerOrigin}`);
          }
          else if (state.settings.players[action.playerOrigin] === undefined) {
            throw new PbemError(`Undefined player: ${action.playerOrigin}`);
          }
        }

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
        // Throw before rolling back; rollback handled by new group.
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

      throw e;
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

