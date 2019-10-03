/** Note: names in this file should be unabbreviated, and easy to remember.
 * */

import {PbemError} from '../error';
export {PbemError} from '../error';

/** Placeholder type for a database ID. */
export type PbemDbId = any;

export interface PbemPlayer {
  // Locally-cached player name.
  name: string;

  // Status of this slot, allowing for invited positions.
  status: 'normal' | 'reserved' | 'bot';

  // Object for resolving this player entity at the DB level
  dbId?: PbemDbId;

  // Settings for this player, if any.  These settings are modified by the
  // player themselves, not the host (except with a bot); game-level settings
  // (balance?) should be handled on the root settings object, not on this.
  playerSettings: any;

  // Only used for reference passing.  Hardcoded to the index in
  // settings.players
  index: number;
}

/** PbemEvents are persistent if in state.events, and are transient if in
 * $pbem.uiEvents.
 * */
export interface _PbemEvent {
  eventId: string;
  type: string;
  game: any;
}
export interface PbemEvent<T> extends _PbemEvent {
  game: T;
}
export namespace PbemEvent {
  export function Type<T>(name: string) {
    return {name} as PbemEvent._Type<T>;
  }
  export function create<E extends PbemEvent._Type<T>, T>(eventId: string,
      eventType: E, game: T): PbemEvent<T> {
    return {
      eventId,
      type: eventType.name,
      game,
    };
  }

  export function queueAdd(queue: _PbemEvent[], event: _PbemEvent) {
    const eid = event.eventId;
    for (let i = queue.length - 1; i > -1; --i) {
      if (queue[i].eventId === eid) {
        queue.splice(i, 1);
      }
    }
    queue.unshift(event);
  }

  export function queueGet<E extends PbemEvent._Type<T>, T>(queue: _PbemEvent[], eventId: string, eventType?: E): PbemEvent<T> | undefined {
    for (let i = 0, m = queue.length; i < m; i++) {
      const q = queue[i];
      if (q.eventId === eventId) {
        if (eventType !== undefined && q.type !== eventType.name) {
          throw new Error(`Bad event type ${q.type} !== ${eventType.name}`);
        }
        return q;
      }
    }
  }

  export function queueRemove<E extends PbemEvent._Type<T>, T>(
      queue: _PbemEvent[], eventId: string, eventType?: E) {
    for (let i = queue.length - 1; i > -1; --i) {
      if (queue[i].eventId === eventId) {
        return queue.splice(i, 1)[0];
      }
    }
    throw new Error(`No event ${eventId} in queue ${queue}`);
  }

  export function queueRemoveIfExists(queue: _PbemEvent[], eventId: string) {
    for (let i = queue.length - 1; i > -1; --i) {
      if (queue[i].eventId === eventId) {
        queue.splice(i, 1)[0];
        return;
      }
    }
  }

  export const UserActionError = Type<string>('PbemEvent.UserActionError');

  export interface _Type<T> {
    name: string;
    empty?: T;
  }
}


export interface _PbemPlayerView {
  playerId: number;  // Will be -1 for PbemServerView.
  state: Readonly<any>;
}
export interface PbemPlayerView<State extends _PbemState, Action extends _PbemAction> extends _PbemPlayerView {
  state: Readonly<State>;
  uiEvents: Array<_PbemEvent>;

  readonly hasPending: boolean;

  // Player events must communicate with the server, and so are asynchronous.
  action(action: Action): Promise<void>;
  // Note that players cannot perform multiple actions at once.

  // Register UI Events this way, so that triggers are handled appropriately.
  //  TODO typescript error:  It's OK because the autocompletion in the Vue
  //  plugin for $pbem uses the comm/index PlayerView interface directly,
  //  but it iseems like this next line should be OK.  It causes an error
  //  instead.
  //  uiEvent<E extends PbemEvent._Type<T>, T>(eventType: E, game: T): void;
}
export interface PbemServerView<State extends _PbemState, Action extends _PbemAction> extends _PbemPlayerView {
  state: Readonly<State>;

  // Server events happen locally, and are thus not asynchronous.
  action(action: Action): void;
}


export interface _PbemSettings {
  gameId?: string;
  version: any;

  playersValid: Array<number>;
  playersMin: number;
  players: Array<PbemPlayer | undefined>;

  // TODO allow games which are not simultaneous. turnSimultaneous: boolean;
  // TODO allow disabling of pass and play?  Probably not.  turnPassAndPlay: boolean;

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
    //settings.turnSimultaneous = true;
    //settings.turnPassAndPlay = true;

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
  actions: readonly PbemActionWithDetails<_PbemAction>[];
  events: Readonly<Array<_PbemEvent[]>>;
  settings: Readonly<_PbemSettings>;
  game: any;
  gameEnded: boolean;
  round: number;
  turnEnded: boolean[];
  plugins: {
    [key: string]: PbemPlugin,
  };
}
export namespace _PbemState {
  export async function create<Settings extends _PbemSettings>(settings: Settings) {
    const s: _PbemState = {
      actions: [],
      events: [],
      settings,
      game: {},
      gameEnded: false,
      round: 1,
      turnEnded: [],
      plugins: {},
    };
    for (let i = 0, m = settings.players.length; i < m; i++) {
      if (settings.players[i] !== undefined) {
        (s.events as _PbemEvent[][]).push([]);
      }
      else {
        // Trick typescript into allowing undefined; user code should be fine
        // assuming events is an array and not undefined.
        (s.events as any).push(undefined);
      }
      s.turnEnded.push(false);
    }
    if (_GameHooks.State!.plugins) {
      s.plugins = _GameHooks.State!.plugins(s);
      for (const p of Object.values(s.plugins)) {
        p.init();
      }
    }
    await _GameHooks.State!.init(s);
    return s as _PbemState;
  }

  export const Hooks: PbemState.Hooks<PbemState<any, any, any>, _PbemAction> = {
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
        pbem.action({type: 'PbemAction.RoundEnd'});

        const re = _GameHooks.State!.roundEnd;
        if (re !== undefined) re(pbem);

        if (!pbem.state.gameEnded) {
          pbem.action({type: 'PbemAction.RoundStart'});
        }
      }
    },
  };
}

export interface PbemPlugin {
  // State passed in constructor.
  //new (state: PbemState<GameSettings, GameState, Plugins>);
  init: {(): void};
  load: {(): void};
}

// TODO PouchDB is communication protocol.  State is stored in a document, yes,
// but is considered largely immutable.  Actions are stored as additional documents,
// which are executed in order to transform the last checkpoint state into the
// current state (on game load).
//
// Game server connects to user databases, and listens for changes which are
// new (requested) actions.  Requested actions have a client ID, which is
// propagated to the final action (for UI callbacks).  Game server thus keeps
// a running tally of actions, some checkpoint state, and everything else
// happens in memory.  Clients can only write their own DB, so messing it up
// really would just ruin their own state.
//
// Game server replicates from itself to all user dbs, at least for now.
//
// PnP: Still works.  Each user represented by their own, local PouchDB 
// connection.  Should be easy enough to allow multiple logged-in users on one
// machine, which then can all participate in PnP when desired.
//
// Another benefit is that server code is always identical.... TBD if latency is
// OK or not.
//
// Use superlogin https://www.npmjs.com/package/superlogin#adding-providers
//
// This article illustrates superlogin fairly well: https://www.joshmorony.com/part-2-creating-a-multiple-user-app-with-ionic-2-pouchdb-couchdb/

export interface PbemState<GameSettings, GameState, Plugins extends {[key: string]: PbemPlugin} = {}> extends _PbemState {
  settings: PbemSettings<GameSettings>;
  game: GameState;
  plugins: Plugins;
}
export type PbemState_Plugins<T> = T extends PbemState<any, any, infer U> ? U : never;
export namespace PbemState {
  export interface Hooks<State extends _PbemState, Action extends _PbemAction> {
    //GameSettings = never, GameState = never, Plugins = never> {
    /** Create an object containing any plugins for the State.  Plugins are
     * helper-modules which are not serialized with the state data, but which
     * provide some features for dealing with the state data. */
    plugins?: {(state: State): PbemState_Plugins<State>};
    /** Create the game by initializing state.game appropriately. */
    init: {(state: State): void};
    /** Convert a loaded game, if necessary. */
    load?: {(state: State): void};
    /** Check for triggers after any action. */
    triggerCheck?: {(pbem: PbemServerView<State, Action>, sinceActionIndex: number): void};
    /** Do something at end of round (actions added are added before the
     * PbemAction.NewRound action). */
    roundEnd?: {(pbem: PbemServerView<State, Action>): void};
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


export interface PbemActionDetails {
  playerOrigin: number;
  actionId: string;
  actionGrouped: boolean;
}
export interface _PbemAction {
  type: any;
  game?: any;
}
export type PbemActionWithDetails<Action extends _PbemAction> = PbemActionDetails & Action;

export namespace _PbemAction {
  let _actionId: number = 0;
  export function create(action: Readonly<_PbemAction>): PbemActionWithDetails<_PbemAction> {
    if (action.type === undefined) {
      // Note that action.game may be undefined
      throw new PbemError(`Undefined action: ${action}`);
    }

    const a: PbemActionWithDetails<_PbemAction> = Object.assign({
      playerOrigin: -1,
      actionId: `l${_actionId}`,
      actionGrouped: false,
    }, action);
    _actionId++;
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
  export interface Hooks<State, Action extends _PbemAction> {
    // TODO ensure error if no init() specified but args were.
    validate?: {(state: Readonly<State>, action: Readonly<PbemActionWithDetails<Action>>): void};
    setup?: {(state: Readonly<State>, action: PbemActionWithDetails<Action>): void};
    forward: {(state: State, action: Readonly<PbemActionWithDetails<Action>>): void};
    validateBackward?: {(state: Readonly<State>, action: Readonly<PbemActionWithDetails<Action>>): void};
    backward: {(state: State, action: Readonly<PbemActionWithDetails<Action>>): void};
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
      setup(state, action) {
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
  State?: PbemState.Hooks<PbemState<any, any, any>, _PbemAction>,
} = {};
export let _GameActionTypes: any | undefined;
export function _pbemGameSetup<
    Settings extends _PbemSettings,
    State extends PbemState<any, any, any>,
    Action extends _PbemAction
  >(settings: PbemSettings.Hooks<Settings>,
    state: PbemState.Hooks<State, Action>,
    actionTypes: any) {
  _GameHooks.Settings = (settings as any) as PbemSettings.Hooks<_PbemSettings>;
    _GameHooks.State = state as any;
  _GameActionTypes = actionTypes;
}

