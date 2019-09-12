/** Note: names in this file should be unabbreviated, and easy to remember.
 * */

import {PbemError} from '../error';
export {PbemError} from '../error';

export interface PbemPlayer {
  name: string;
  // Only used for reference passing.  Hardcoded to the index in
  // settings.players
  index: number;
}


export interface _PbemPlayerView {
  playerId: number;  // Will be -1 for PbemServerView.
  state: Readonly<any>;
}
export interface PbemPlayerView<State extends _PbemState> extends _PbemPlayerView {
  state: Readonly<State>;

  readonly hasPending: boolean;

  // Player events must communicate with the server, and so are asynchronous.
  action(type: string, ...args: any[]): Promise<void>;
  // Note that players cannot perform multiple actions at once.
}
export interface PbemServerView<State extends _PbemState> extends _PbemPlayerView {
  state: Readonly<State>;

  // Server events happen locally, and are thus not asynchronous.
  action(type: string, ...args: any[]): void;
  // Server can perform several actions at once as a shortcut.
  actionMulti(...actions: Array<[string, ...any[]]>): void;
}


export interface _PbemSettings {
  gameId?: string;
  version: any;

  playersValid: Array<number>;
  playersMin: number;
  players: Array<PbemPlayer | undefined>;

  turnSimultaneous: boolean;
  turnPassAndPlay: boolean;

  game: any;
}
export namespace _PbemSettings {
  /** Initialize to sane defaults.  Most should be overridden by game code.
   * */
  export function create(): _PbemSettings {
    const settings = {} as _PbemSettings;
    settings.version = 0;
    settings.playersValid = [2];
    settings.playersMin = 1;
    settings.players = [];
    settings.turnSimultaneous = true;
    settings.turnPassAndPlay = true;

    // Will always be populated by user Settings.Hooks.init().
    settings.game = {};

    return settings;
  }

  export const Hooks: PbemSettings.Hooks<_PbemSettings> = {
    init(settings) {
      //Already done in no-argument create()
    },
    validate(settings) {
      const p = settings.players.length;
      if (settings.playersValid.indexOf(p) < 0) {
        throw new PbemError(`Unsupported number of players: ${p}`);
      }
      const actualPlayers = settings.players.reduce(
          (a, b) => a + (b ? 1 : 0), 0);
      if (actualPlayers < settings.playersMin) {
        throw new PbemError(`Not enough players: ${actualPlayers} / ${settings.playersMin}`);
      }
    },
  };
}

export interface PbemSettings<GameSettings> extends _PbemSettings {
  game: GameSettings;
}
export namespace PbemSettings {
  export interface Hooks<Settings> {
    init: {(settings: Settings): void},
    validate?: {(settings: Readonly<Settings>): void},
  }
}


export interface _PbemState {
  actions: _PbemAction[];
  settings: _PbemSettings;
  game: any;
  gameEnded: boolean;
  round: number;
  turnEnded: boolean[];
}
export namespace _PbemState {
  export async function create<Settings extends _PbemSettings>(settings: Settings) {
    const s: _PbemState = {
      actions: [],
      settings,
      game: {},
      gameEnded: false,
      round: 1,
      turnEnded: [],
    };
    for (let i = 0, m = settings.players.length; i < m; i++) {
      s.turnEnded.push(false);
    }
    await _GameHooks.State!.init(s);
    return s;
  }

  export const Hooks: PbemState.Hooks<_PbemState, _PbemAction> = {
    // Just to keep typescript happy.
    init(state) {},
    triggerCheck(pbem, sinceActionIndex) {
      let allDone = true;
      const p = pbem.state.settings.players;
      for (let i = 0, m = p.length; i < m; i++) {
        if (p[i] === undefined) continue;
        allDone = allDone && pbem.state.turnEnded[i];
      }
      if (allDone) {
        // All ready - advance round.
        pbem.action('PbemAction.RoundEnd');

        const re = _GameHooks.State!.roundEnd;
        if (re !== undefined) re(pbem);

        if (!pbem.state.gameEnded) {
          pbem.action('PbemAction.RoundStart');
        }
      }
    },
  };
}

export interface PbemState<GameSettings, GameState> extends _PbemState {
  settings: PbemSettings<GameSettings>;
  game: GameState;
}
export namespace PbemState {
  export interface Hooks<State extends _PbemState, Action extends _PbemAction> {
    /** Create the game by initializing state.game appropriately. */
    init: {(state: State): void};
    /** Convert a loaded game, if necessary. */
    load?: {(state: State): void};
    /** Check for triggers after any action. */
    triggerCheck?: {(pbem: PbemServerView<State>, sinceActionIndex: number): void};
    /** Do something at end of round (actions added are added before the
     * PbemAction.NewRound action). */
    roundEnd?: {(pbem: PbemServerView<State>): void};
  }


  export function getRoundActions<State extends _PbemState>(state: State) {
    const act = state.actions;
    let i = act.length - 1;
    while (i >= 0) {
      if (act[i].type === 'PbemAction.RoundStart' || act[i].type === 'PbemAction.GameEnd') {
        break;
      }
      --i;
    }
    return act.slice(i + 1);
  }
}


export interface _PbemAction {
  type: any;
  playerOrigin: number;
  actionId: string;
  actionGrouped: boolean;
  game: any;
}
export namespace _PbemAction {
  let _actionId: number = 0;
  export function create(type: string, ...args: any[]): _PbemAction {
    const a: _PbemAction = {
      type,
      playerOrigin: -1,
      actionId: `l${_actionId}`,
      actionGrouped: false,
      game: {},
    };
    _actionId++;
    const ns = _PbemAction.resolve(type);
    if (ns.init !== undefined) {
      ns.init(a, ...args);
    }
    else if (args.length > 0) {
      throw new PbemError(`No PbemAction.Hooks.init() for ${type}, but args`);
    }
    return a;
  }
  export function resolve(type: string): PbemAction.Hooks<_PbemState, _PbemAction> {
    let ns: any = undefined;
    if (type.startsWith('PbemAction.')) {
      ns = (PbemAction.Types as any)[type.slice(11)];
    }
    else {
      ns = (_GameActionTypes as any)[type];
    }

    if (ns === undefined) {
      throw new PbemError(`Couldn't resolve ${type}`);
    }

    return ns as PbemAction.Hooks<_PbemState, _PbemAction>;
  }
}

export interface PbemAction<GameActionType, GameAction> extends _PbemAction {
  type: GameActionType;
  game: GameAction;
}
export namespace PbemAction {
  export interface Hooks<State, Action> {
    // TODO ensure error if no init() specified but args were.
    init?: {(action: Action, ...args:any): void};
    validate?: {(state: Readonly<State>, action: Readonly<Action>): void};
    setupBackward?: {(state: Readonly<State>, action: Action): void};
    forward: {(state: State, action: Readonly<Action>): void};
    validateBackward?: {(state: Readonly<State>, action: Readonly<Action>): void};
    backward: {(state: State, action: Readonly<Action>): void};
  }

  export namespace Types {
    export type Builtins = GameEnd | RoundEnd | RoundStart | TurnEnd;

    export type GameEnd = PbemAction<'PbemAction.GameEnd', {}>;
    export const GameEnd: Hooks<_PbemState, GameEnd> = {
      validate(state, action) {
        if (action.playerOrigin >= 0) {
          throw new PbemError('Must be server to end game');
        }
      },
      forward(state, action) {
        state.gameEnded = true;
      },
      backward(state, action) {
        state.gameEnded = false;
      },
    };

    export type RoundEnd = PbemAction<'PbemAction.RoundEnd', {
      turnEnded?: boolean[],
    }>;
    export const RoundEnd: Hooks<_PbemState, RoundEnd> = {
      validate(state, action) {
        if (action.playerOrigin >= 0) {
          throw new PbemError('Must be server to end round');
        }
      },
      setupBackward(state, action) {
        action.game.turnEnded = state.turnEnded.slice();
      },
      forward(state, action) {
        state.round += 1;
        state.turnEnded = state.turnEnded.map((x) => false);
      },
      backward(state, action) {
        state.turnEnded = action.game.turnEnded!.slice();
        state.round -= 1;
      },
    };

    export type RoundStart = PbemAction<'PbemAction.RoundStart', {
    }>;
    export const RoundStart: Hooks<_PbemState, RoundStart> = {
      validate(state, action) {
        if (action.playerOrigin >= 0) {
          throw new PbemError('Must be server to start round');
        }
      },
      forward(state, action) {
      },
      backward(state, action) {
      },
    };

    export type TurnEnd = PbemAction<'PbemAction.TurnEnd', {}>;
    export const TurnEnd: Hooks<_PbemState, TurnEnd> = {
      validate(state, action) {
        if (action.playerOrigin < 0) {
          throw new PbemError('Must be player to end turn');
        }

        if (state.turnEnded[action.playerOrigin]) {
          throw new PbemError('Cannot end turn twice');
        }

        if (state.turnEnded.length <= action.playerOrigin) {
          throw new PbemError('Ending turn of non-existent player?');
        }
      },
      forward(state, action) {
        state.turnEnded.splice(action.playerOrigin, 1, true);
      },
      backward(state, action) {
        state.turnEnded.splice(action.playerOrigin, 1, false);
      },
    };
  }
}


export const _GameHooks: {
  Settings?: PbemSettings.Hooks<_PbemSettings>,
  State?: PbemState.Hooks<_PbemState, _PbemAction>,
} = {};
export let _GameActionTypes: any | undefined;
export function _pbemGameSetup<
    Settings extends _PbemSettings,
    State extends _PbemState,
    Action extends _PbemAction
  >(settings: PbemSettings.Hooks<Settings>,
    state: PbemState.Hooks<State, Action>, actionTypes: any) {
  _GameHooks.Settings = (settings as any) as PbemSettings.Hooks<_PbemSettings>;
  _GameHooks.State = (state as any) as PbemState.Hooks<_PbemState, _PbemAction>;
  _GameActionTypes = actionTypes;
}

