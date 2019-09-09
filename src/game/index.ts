
export interface PbemPlayer {
  name: string;
  score: number;
  online: boolean;
}


export interface _PbemPlayerView {
  playerId: number;
  state: Readonly<any>;

  readonly hasPending: boolean;

  action(type: string, ...args: any[]): Promise<void>;
  actionMulti(...actions: Array<[string, ...any[]]>): Promise<void>;
}
export interface PbemPlayerView<State extends _PbemState> extends _PbemPlayerView {
  state: Readonly<State>;
}


import {ServerLink as _ServerLink} from '../comm';
export function Pbem<State extends _PbemState>(state: State) {
  // TODO this is broken on server-side for multiple games at the moment.
  // Should not rely on ServerLink
  return _ServerLink.getActivePlayerView<State>();
}


export interface _PbemSettings {
  gameId?: string;
  version: any;

  playersValid: Array<number>;
  players: Array<PbemPlayer>;

  turnSimultaneous: boolean;
  turnPassAndPlay: boolean;

  game: any;
}
export namespace _PbemSettings {
  /** Initialize to sane defaults.  Most should be overridden by game code.
   * */
  export async function create(): Promise<_PbemSettings> {
    const settings = {} as _PbemSettings;
    settings.version = 0;
    settings.playersValid = [2];
    settings.players = [];
    settings.turnSimultaneous = true;
    settings.turnPassAndPlay = true;

    // Will always be populated by user Settings.pbemInit().
    settings.game = {};

    return settings;
  }

  export const Hooks: PbemSettings.Hooks<_PbemSettings> = {
    async pbemInit(settings) {
      //Already done in no-argument create()
    },
  };
}

export interface PbemSettings<GameSettings> extends _PbemSettings {
  game: GameSettings;
}
export namespace PbemSettings {
  export interface Hooks<Settings> {
    pbemInit: {(settings: Settings): Promise<void>},
    pbemValidate?: {(settings: Readonly<Settings>): Promise<void>},
  }
}


export interface _PbemState {
  settings: _PbemSettings;
  game: any;
}
export namespace _PbemState {
  export async function create<Settings extends _PbemSettings>(settings: Settings) {
    const s: _PbemState = {
      settings,
      game: {},
    };
    await _GameHooks.State!.pbemInit(s);
    return s;
  }
}

export interface PbemState<GameSettings, GameState> extends _PbemState {
  settings: PbemSettings<GameSettings>;
  game: GameState;
}
export namespace PbemState {
  export interface Hooks<State extends _PbemState, Action extends _PbemAction> {
    /** Create the game by initializing state.game appropriately. */
    pbemInit: {(state: State): Promise<void>};
    /** Convert a loaded game, if necessary. */
    pbemLoad?: {(state: State): Promise<void>};
    /** Check for triggers after any action. */
    pbemTriggerCheck?: {(pbem: PbemPlayerView<State>, action: Readonly<Action>): Promise<void>};
    /** Do something at end of turn (actions added are added before the true
     * PbemAction.EndTurn action. */
    pbemTurnEnd?: {(pbem: PbemPlayerView<State>): Promise<void>};
  }
}


export interface _PbemAction {
  type: any;
  playerOrigin?: number;
  game: any;
}
export interface PbemAction<GameActionType, GameAction> extends _PbemAction {
  type: GameActionType;
  game: GameAction;
}
export namespace PbemAction {
  export interface Hooks<State, Action> {
    create: {(...args:any): Action};
    pbemValidate?: {(state: State, action: Action): any};
  }

  export namespace Types {
    export type Builtins = Multi;

    export type GameEnd = PbemAction<'PbemAction.GameEnd', {}>;
    export const GameEnd: Hooks<_PbemState, GameEnd> = {
      create() {
        return {
          type: 'PbemAction.GameEnd',
          game: {},
        };
      },
    };

    export type Multi = PbemAction<'PbemAction.Multi', Array<_PbemAction>>;
    export const Multi: Hooks<_PbemState, Multi> = {
      create(args: Array<_PbemAction>) {
        return {
          type: 'PbemAction.Multi',
          game: args,
        };
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

