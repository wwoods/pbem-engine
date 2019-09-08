/** Games using this engine have three key components:
 *
 * Settings: The initialization information required for constructing a new
 * instance of the game.
 *
 * State: All state information required to display/save/load a game.
 *
 * Action: Operations which players may perform that mutate the game state.
 *
 * Due to JSON-based serialization, no object in the hierarchy should refer to
 * another directly.  Use e.g. an Entity-Component framework, where entities
 * refer to one another by ID.
 * */

import {PbemSettings, PbemState, PbemAction} from 'pbem-engine/lib/game';
// TODO PbemState.Writable = Readonly<PbemState>

/** User-defined settings - everything non-player-related required for
 * initializing a new game. */
export interface GameSettings {
  playerOneIsO: boolean;
}
export type Settings = PbemSettings<GameSettings>;
export namespace Settings {
  export function pbemInit(settings: Settings): void {
    settings.playersValid = [2];
    // Can use version field to retain cross-version compatibility; note that
    // this version is also used to ensure players are using the same version
    // of the software.
    settings.version = 1;
    // Can be false for non-simultaneous turns.
    settings.turnSimultaneous = true;
    // Can be true for pass-and-play functionality.
    settings.turnPassAndPlay = false;

    const s = settings.game;
    s.playerOneIsO = false;
  }

  export function pbemValidate(settings: Readonly<Settings>): any {
    if (settings.players.length !== 2) {
      // Anything not-undefined returned is routed to the UI.
      return "Not enough players.";
    }
  }
}



/** State of the game.
 *
 * Hooks (called on primary host only; must not write to state):
 *
 *  pbemLoad: called when the game was loaded.  Can e.g. update version.
 *  pbemTriggerCheck: called after any user action.  Can e.g. apply subsequent
 *    actions which were direct results of the user action.
 *  pbemTurnEnd: called when the turn ends.  Can apply actions.
 * */
export interface GameState {
  board: string[];
  playerSymbol: string[];
  playerWillWin?: number;
}
export type State = PbemState<GameSettings, GameState>;
export namespace State {
  export function pbemInit(state: State): void {
    const g = state.game;
    g.board = [];
    for (let i = 0; i < 9; i++) g.board.push(' ');

    const settings = state.settings.game;
    g.playerSymbol = settings.playerOneIsO ? ['o', 'x'] : ['x', 'o'];
  }

  export async function pbemTriggerCheck(state: Readonly<State>): Promise<void> {
    if (state.game.playerWillWin === undefined) {
      //state.game === this
      const g = state.game;
      let p: string = ' ';;
      for (let i = 0; i < 3; i++) {
        const a = g.board[i];
        if (a !== ' '
            && a === g.board[i + 3]
            && a === g.board[i + 6]) {
          p = a;
        }
      }
      for (let i = 0; i < 9; i += 3) {
        const a = g.board[i];
        if (a !== ' '
            && a === g.board[i + 1]
            && a === g.board[i + 2]) {
          p = a;
        }
      }

      {
        const a = g.board[5];
        if (a !== ' '
            && (
              a === g.board[0] && a === g.board[8]
              || a === g.board[3] && a === g.board[6])) {
          p = a;
        }
      }

      if (p !== ' ') {
        const player = g.playerSymbol.indexOf(p);
        //TODO await PbemState.action(state, Action.WillWin.create(player));
      }
    }
  }

  export async function pbemTurnEnd(state: Readonly<State>) {
    if (state.game.playerWillWin !== undefined) {
      const player = state.game.playerWillWin;
      await PbemState.action(state, PbemAction.Multi.create([
          //Action.ThreeInARow.create(player),
          PbemAction.GameEnd.create(),
      ]));
    }
  }
}


/** PbemActions live the following lifecycle:
 *
 * forward: constructor() -> validate() -> setupBackward() -> forward()
 * backward: [validateBackward() ->] backward() -> validate() [fail -> forward()]
 *
 * Note that validateBackward() is only executed if the backward is
 * user-initiated, and is used to allow out-of-order backwards.
 *
 * Actions must have a "type" identifier which corresponds to a namespace in
 * the "Action" namespace.
 *
 * Actions must also have an optional "playerOrigin" identifier which is used to
 * validate that players create actions only for themselves.  The game is
 * responsible for ensuring that players only move their own pieces.
 *
 */
export type Action = PbemAction.Builtins | Action.Play; //TODO | Action.ThreeInARow | Action.WillWin;
export namespace Action {
  /// Make a move
  export type Play = PbemAction<'Play', {
    space: number,
  }>;
  export const Play: PbemAction.Hooks<State, Play> = {
    create(player: number, space: number) {
      return {
        type: 'Play',
        playerOriginatedz: player,
        game: {
          space: space,
        },
      };
    },
    pbemValidate(state, action) {
    },
  };
  /*
  export namespace Play2 {
    export function create(player: number, space: number): play {
      return PbemAction.create('Play', player, {space});
    }

    export function pbemValidate(state: Readonly<State>, action: Readonly<Play>): any {
      if ([0, 1].indexOf(action.playerOrigin) === -1) return 'Bad player';

      // Tic-tac-toe only has one move per turn.
      // TODO actions[] should not be a list of player actions... computed
      // property?  No, using interfaces... PbemState.playerActionCount()?
      if (state.turn.actions[action.playerOrigin].length > 0) return 'No free action';

      // Cannot play in occupied space.
      if (state.game.board[action.game.space] !== ' ') return 'Space taken';
    }

    export function pbemSetupBackward(State: Readonly<State>, action: play) {
      // Record whatever's needed for a proper rollback.
    }

    export function pbemForward(state: State, action: Readonly<Play>) {
      state.game.board[action.game.space] = state.game.playerSymbol[action.playerOrigin];
    }

    export function pbemValidateBackward(state: Readonly<State>, action: Readonly<Play>): any {
    }

    export function pbemBackward(state: State, action: Readonly<Play>): any {
      state.game.board[action.game.space] = ' ';
    }
  }*/

    /*
  /// Will win
  export type willWin = PbemAction<'willWin', {
    player: number,
  }>;
  export interface willWin {
    export function create(player: number): willWin {
      return PbemAction.create('willWin', null, {player});
    }

    export function pbemValidate(state: Readonly<State>, action: willWin): void {
      //TODO ensure this player has three in a row.

      if (action.playerOrigin !== undefined) return "Unauthorized";

      if (state.game.playerWillWin !== undefined) return "Winner already set.";
    }

    export function pbemForward(state: State, action: willWin): void {
      state.game.playerWillWin = action.player;
    }

    export function pbemBackward(state: State, action: willWin): void {
      state.game.playerWillWin = undefined;
    }
  }


  /// Three in a row
  export interface threeInARow extends Action {
    player: number;
  }
  export namespace threeInARow {
    export function create(player: number): threeInARow {
      return {
        type: 'threeInARow',
        player: player,
      };
    }

    export function pbemValidate(pbem: PbemState<State>, action: threeInARow): void {
      if (action.playerOrigin !== undefined) return "Unauthorized";
    }

    export function pbemForward(pbem: PbemState.Writable<State>, action: threeInARow): void {
      pbem.player[action.player].score += 1;
    }

    export  function pbemBackward(pbem: PbemState.Writable<State>, action: threeInARow): void {
      pbem.player[action.player].score -= 1;
    }
  }*/
}

