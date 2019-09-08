
export interface PbemPlayer {
  name: string;
  score: number;
}


export interface _PbemSettings {
  version: any;

  playersValid: Array<number>;
  players: Array<PbemPlayer>;

  turnSimultaneous: boolean;
  turnPassAndPlay: boolean;

  game: any;
}
export interface PbemSettings<GameSettings> extends _PbemSettings {
  game: GameSettings;
}
export namespace PbemSettings {
  /** Create a default settings.  Most of these should be overwritten.
   * */
  export function create():_PbemSettings {
    return {
      version: 0,
      playersValid: [2],
      players: [],
      turnSimultaneous: true,
      turnPassAndPlay: true,
      // Will always be populated by user Settings.pbemInit().
      game: {},
    };
  }
}


export interface _PbemState {
}
export interface PbemState<GameSettings, GameState> extends _PbemState {
  settings: PbemSettings<GameSettings>;
  game: GameState;
}
export namespace PbemState {
  export async function action(state: _PbemState, action: _PbemAction):
    Promise<void> {
    //TODO
  }
}


export interface _PbemAction {}
export interface PbemAction<GameActionType, GameAction> {
  type: GameActionType;
  playerOrigin?: number;
  game: GameAction;
}
export namespace PbemAction {
  export type Builtins = Multi;

  export interface Hooks<State, Action> {
    create: {(...args:any): Action};
    pbemValidate?: {(state: State, action: Action): any};
  }

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

