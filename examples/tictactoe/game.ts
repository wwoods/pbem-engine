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

import {PbemError, PbemSettings, PbemState, PbemAction} from 'pbem-engine/lib/game';
// TODO PbemState.Writable = Readonly<PbemState>

/** User-defined settings - everything non-player-related required for
 * initializing a new game. */
export interface GameSettings {
  playerOneIsO: boolean;
}
export type Settings = PbemSettings<GameSettings>;
export namespace Settings {
  export const Hooks: PbemSettings.Hooks<Settings> = {
    init(settings) {
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
    },
    validate(settings) {
      if (settings.players.length !== 2) {
        // Anything not-undefined returned is routed to the UI.
        throw new PbemError("Not enough players.");
      }
    },
  };
}



/** State of the game.
 *
 * Hooks (called on primary host only; must not write to state):
 *
 *  pbemInit: called when the game is started.  Must set up game.
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
  export const Hooks: PbemState.Hooks<State, Action> = {
    init(state) {
      console.log('RAN INIT HOOK');
      const g = state.game;
      g.board = [];
      for (let i = 0; i < 9; i++) g.board.push(' ');

      const settings = state.settings.game;
      g.playerSymbol = settings.playerOneIsO ? ['o', 'x'] : ['x', 'o'];
    },
    triggerCheck(pbem, sinceAction) {
      const state = pbem.state;
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
          const a = g.board[4];
          if (a !== ' '
              && (
                a === g.board[0] && a === g.board[8]
                || a === g.board[2] && a === g.board[6])) {
            p = a;
          }
        }

        if (p !== ' ') {
          const player = g.playerSymbol.indexOf(p);
          pbem.action('WillWin', player);
        }
      }
    },
    roundEnd(pbem) {
      const player = pbem.state.game.playerWillWin;
      if (player !== undefined) {
        pbem.actionMulti(
            ['ThreeInARow', player],
            ['PbemAction.GameEnd'],
        );
      }
    }
  };
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
export type Action = PbemAction.Types.Builtins | Action.Types.Play | Action.Types.WillWin | Action.Types.ThreeInARow;
export namespace Action {
  export namespace Types {
    /// Make a move
    export type Play = PbemAction<'Play', {
      space: number,
    }>;
    export const Play: PbemAction.Hooks<State, Play> = {
      init(action, space: number) {
        action.game.space = space;
      },
      validate(state, action) {
        if ([0, 1].indexOf(action.playerOrigin) === -1) throw new PbemError('Bad player');

        if (action.game.space === undefined) throw new PbemError('Undefined space?');
        if (action.game.space < 0 || action.game.space >= 9) throw new PbemError(`Out of bounds: ${action.game.space}`);

        // Tic-tac-toe only has one move per turn.
        // TODO actions[] should not be a list of player actions... computed
        // property?  No, using interfaces... PbemState.playerActionCount()?
        const actions = PbemState.getRoundActions(state)
            .filter((x) => !x.actionGrouped && x.playerOrigin === action.playerOrigin)
            ;
        if (actions.length > 0) throw new PbemError('No free action');

        // Cannot play in occupied space.
        const sym = state.game.board[action.game.space];
        if (sym !== ' ') throw new PbemError(`Space taken: ${sym}`);
      },
      forward(state, action) {
        // IMPORTANT: cannot do state.game.board[action.game.space] = ...
        // See e.g. Vue's documentation on the matter here:
        // https://vuejs.org/v2/guide/reactivity.html#Change-Detection-Caveats
        // Instead, use splice.
        state.game.board.splice(action.game.space, 1, state.game.playerSymbol[action.playerOrigin]);
      },
      backward(state, action) {
        state.game.board.splice(action.game.space, 1, ' ');
      },
    };


    export type WillWin = PbemAction<'WillWin', {
      player: number,
    }>;
    export const WillWin: PbemAction.Hooks<State, WillWin> = {
      init(action, player: number) {
        action.game.player = player;
      },
      validate(state, action) {
        if (action.playerOrigin !== -1) throw new PbemError("Unauthorized");

        if (state.game.playerWillWin !== undefined) return "Winner already set.";
      },
      forward(state, action) {
        state.game.playerWillWin = action.game.player;
      },
      backward(state, action) {
        state.game.playerWillWin = undefined;
      },
    };


    /// Three in a row
    export type ThreeInARow = PbemAction<'ThreeInARow', {
      player: number;
    }>;
    export const ThreeInARow: PbemAction.Hooks<State, ThreeInARow> = {
      init(action, player: number) {
        action.game.player = player;
      },
      validate(state, action) {
        if (action.playerOrigin !== -1) throw new PbemError("Unauthorized");
      },
      forward(state, action) {
        // TODO should be state.players... state.settings shouldn't change?
        state.settings.players[action.game.player].score += 1;
      },
      backward(state, action) {
        state.settings.players[action.game.player].score -= 1;
      },
    };
  }
}

