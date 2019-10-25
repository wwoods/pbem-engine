
import createDebug from 'debug';

import {_GameHooks, _PbemAction, _PbemState, PbemActionWithDetails, PbemPlugin, 
  PbemServerView} from '../game';
import {ServerError} from '../server/common';
import {DbGame, DbUserActionRequestDoc, DbUserActionDoc, DbGameStateDoc} from '../server/db';

export interface GamePlayerWatcherOptions {
  // In `init()`, do not run a findContinuous.  That will be handled externally.
  noContinuous?: boolean;
}

/** A local viewer for a game.  Responsible for change watching and keeping
 * local state up-to-date by applying / undoing actions.
 * 
 * Also runs the system, when _playerIdx === -1.
 * */
export class GamePlayerWatcher {
  _debug: debug.Debugger;

  // Database containing game.
  _db: PouchDB.Database<DbGame>;

  // Game ID.
  _gameId: string;

  // If defined, store a list of changes which need to be processed after 
  // initialization is confirmed.
  _initQueue?: DbGame[] = [];

  // Player index (-1 for system)
  _playerIdx: number;

  // List of past / future actions.  Treat as local cache.
  _actions: string[] = [];
  _actionCurrent!: string;
  // Mapping between request doc _id and game-data-action _id
  _actionRequestNewIds: {[key: string]: string} = {};
  // Cache of all loaded / played / previewed actions...  Note that request
  // docs are inappropriate, as they do not allow for rollback/forward.
  _actionCache: {[key: string]: DbUserActionDoc} = {};

  // State, if loaded in any other phase
  _state!: _PbemState;

  // Action group for currently-executing action
  _actionGroup?: PbemActionWithDetails<_PbemAction>[];

  _options: GamePlayerWatcherOptions;
  _findCancel?: PouchDB.FindContinuousCancel;

  get state() { return this._state; }

  constructor(userDb: PouchDB.Database<DbGame>, gameId: string, 
      playerIdx: number, options: GamePlayerWatcherOptions = {}) {
    this._debug = createDebug(`pbem-engine:game-watch-${gameId}-${playerIdx}`);
    this._db = userDb;
    this._gameId = gameId;
    this._playerIdx = playerIdx;
    this._options = options;
  }


  /** Start watching, ensure first state is fetched before returning. */
  async init() {
    if (this._initQueue === undefined) {
      throw new ServerError.ServerError("Init() called twice?");
    }

    const {docs} = await this._db.find({
      selector: {game: this._gameId, type: 'game-data-state'},
      // Until multi-index bug is fixed, cannot make an index with round.
      //sort: [{round: 'desc'}],
      //limit: 1,
    });

    if (docs.length === 0) throw new ServerError.NoSuchGameError(this._gameId);
    (docs as any).sort((a: DbGameStateDoc, b: DbGameStateDoc) => b.round - a.round);

    const doc = docs[0] as DbGameStateDoc;
    const s = this._state = doc.state;
    this._actionCurrent = doc.actionPrev;
    this._actions = [doc.actionPrev];

    // Load plugins
    if (_GameHooks.State!.plugins) {
      const plugins = _GameHooks.State!.plugins(s);
      s.plugins = plugins;
      for (const p of Object.values(plugins)) {
        (p as PbemPlugin).load();
      }
    }

    await this._actionLoadLatest();

    const queue = this._initQueue!;
    delete this._initQueue;

    this._debug('Initialized OK');

    if (this._options.noContinuous) {
      for (const d of queue) {
        this.triggerLoadOrChange(d);
      }
      return;
    }
    this._findCancel = this._db.findContinuous(
        {game: this._gameId},
        doc => {
          this.triggerLoadOrChange(doc);
        },
        noMatches => {
        },
    );
  }

  async action(actionBase: _PbemAction) {
    const aprev = this._actions[this._actions.length - 1];
    if (this._actionCurrent !== aprev) {
      throw new ServerError.ServerError("Looking at the past, cannot act");
    }

    const state = this._state;
    const action = _PbemAction.create(actionBase);
    action.playerOrigin = this._playerIdx;

    if (this._actionGroup !== undefined) {
      // Part of an ongoing action group, run it no matter what.
      this._actionValidateAndRun(action);
      return;
    }
    
    if (this._playerIdx === -1) {
      // _playerIdx === -1 means system, so actually run the action as part of
      // a new action group.
      await this._actionValidateAndRunWithTriggersAndCommit(action);
    }
    else {
      // Validate even if we don't run the action.
      const hooks = _PbemAction.resolve(action.type);
      if (hooks.validate !== undefined) {
        hooks.validate(state, action);
      }

      // Users can only request to try an action... for now.
      const actionId = this._db.getUuid();
      const actionDoc: DbUserActionRequestDoc = {
        _id: actionId,
        type: 'game-response-action',
        game: this._gameId,
        action: action,
        prev: aprev,
      };
      // If we ran forward()...
      //this._actions.push(actionId);
      //this._actionCache[actionId] = actionDoc;
      //this._actionCurrent = actionId;
      // Async... do local modifications first
      const r = await this._db.put(actionDoc);
    }
  }

  /** Stop watching, prepare for disposal. */
  cancel() {
    if (this._findCancel !== undefined) {
      this._findCancel.cancel();
      this._findCancel = undefined;
    }
  }

  /** A document was changed or loaded; check it. */
  triggerLoadOrChange(doc: DbGame) {
    // When a game document is deleted, we have nothing to do.  Some other
    // change would have happened in tandem.
    if (doc._deleted) return;

    if (this._initQueue !== undefined) {
      this._initQueue.push(doc);
      return;
    }

    if (doc.type === 'game-data') {
      this._debug('game-data');
    }
    else if (doc.type === 'game-data-state') {
      // Last state should be fine, no need to override.
    }
    else if (doc.type === 'game-data-action') {
      // Confirmed action to be added to queue.  See if we need to run this 
      // action.
      const currentIdx = this._actions.indexOf(doc._id!);
      if (currentIdx !== -1) {
        // Already catalogued.  There's a chance that "prev" changed.
        if (this._actionCache.hasOwnProperty(doc._id!)) {
          const docOld = this._actionCache[doc._id!];
          if (docOld.prev !== doc.prev) {
            throw new ServerError.ServerError("Not implemented: TODO");
          }
        }
        if (doc.prev !== undefined && currentIdx > 0
            && doc.prev !== this._actions[currentIdx - 1]) {
          throw new ServerError.ServerError("Not Implemented: TODO better test");
        }
        this._actionCache[doc._id!] = doc;
        return;
      }

      if (doc.prev === undefined) {
        // Must be first event.  Safe to ignore, as any state would involve
        // loading at least this state.
        return;
      }

      // Overwrite cache.
      this._actionCache[doc._id!] = doc;

      const actionCurrent = this._actionCurrent;
      if (doc.request !== undefined) {
        this._actionRequestNewIds[doc.request] = doc._id!;
        const rid = this._actions.indexOf(doc.request);
        if (rid !== -1) {
          // Request can be deleted; was it enacted as-is?
          if (doc.prev === this._actions[rid - 1]) {
            if (this._actionCurrent === doc.request) {
              this._actionCurrent = doc._id!;
            }
            return;
          }

          // Out of order... rollback?
          const a = this._actions.indexOf(actionCurrent);
          if (a > rid) {
            // Rollback / commit the removal of this request
            this._actionRollback(this._actions[rid - 1]);
            this._actions.splice(rid, 1);
          }
        }
      }

      const u = this._actions.indexOf(doc.prev);
      if (u === -1) {
        // We have no point of reference for this action.  
        this._debug(`Ok to ignore action ${doc._id}?`);
        this._actionRollforward(actionCurrent);
        return;
      }

      this._actions.splice(u+1, 0, doc._id!);
      // Restore previous action
      this._actionRollforward(actionCurrent);
      if (this._actionCurrent === doc.prev) {
        this._actionRollforward(doc._id!);
      }
    }
    else if (doc.type === 'game-response-action') {
      // Requested action...
      if (this._actionRequestNewIds[doc._id!] !== undefined) {
        // This request was turned into a real action, which has priority.
        return;
      }

      if (this._playerIdx !== -1) {
        // Ignore;
        return;
      }

      this._gameCheckNextAction();
    }
    else {
      this._debug(`Unhandled: ${doc.type}`);
    }
  }


  /** Load those in "_actions" and future actions.
   * 
   * Should also load back to RoundStart.
   */
  async _actionLoadLatest() {
    for (const a of this._actions) {
      if (!this._actionCache.hasOwnProperty(a)) {
        // TODO what about requests???
        this._actionCache[a] = await this._db.get(a);
      }
    }

    while (true) {
      const a = this._actions[this._actions.length - 1];
      const {docs} = await this._db.find({selector: {game: this._gameId,
          prev: a, type: 'game-data-action'}});

      if (docs.length === 0) {
        // No further actions; abort
        break;
      }

      if (docs.length !== 1) {
        // When loading a chain, the only way this should happen is if prev
        // got overwritten...
        this._debug(`bad condition, multiple docs for ${a}`);
      }

      const d = docs[0];
      if (d.type === 'game-data-action') {
        this._actions.push(d._id);
        this._actionCache[d._id] = d;
      }
      else if (d.type === 'game-response-action') {
        //TODO
      }
      else {
        this._debug(`Bad follow doc? ${d.type} / ${d._id}`);
      }
    }

    // Find earliest RoundStart, if this._actions[0] is not a round start
    let firstAction = this._actionCache[this._actions[0]];
    while (firstAction.actions[0].type !== 'PbemAction.RoundStart') {
      if (firstAction.prev === undefined) {
        this._debug(`No first action which is 'PbemAction.RoundStart'?`);
        break;
      }
      const prevAction: DbUserActionDoc = await this._db.get(firstAction.prev);
      this._actions.unshift(prevAction._id!);
      this._actionCache[prevAction._id!] = prevAction;
      firstAction = prevAction;
    }

    // Go to latest action.
    this._actionRollforward(this._actions[this._actions.length - 1]);
  }


  /** Rewind cached actions without validating */
  _actionRollback(id: string) {
    const curId = this._actions.indexOf(this._actionCurrent);
    const targId = this._actions.indexOf(id);

    if (curId === -1) throw new ServerError.ServerError("Bad _actionCurrent?");
    if (targId === -1) throw new ServerError.ServerError("Bad target id?");

    if (curId < targId) throw new ServerError.ServerError("Should be rollforward?");

    const state = this._state;
    for (let i = curId-1; i >= targId; i--) {
      const aId = this._actions[i];
      const aDoc = this._actionCache[aId];
      for (let i = aDoc.actions.length - 1; i >= 0; i--) {
        const a = aDoc.actions[i];
        const hooks = _PbemAction.resolve(a.type);
        hooks.backward(state, a);
      }
      this._actionCurrent = aId;
    }
  }


  /** Commit cached actions without validating */
  _actionRollforward(id: string) {
    const curId = this._actions.indexOf(this._actionCurrent);
    const targId = this._actions.indexOf(id);

    if (curId === -1) throw new ServerError.ServerError("Bad _actionCurrent?");
    if (targId === -1) throw new ServerError.ServerError("Bad target id?");

    if (curId > targId) throw new ServerError.ServerError("Should be rollback?");

    const state = this._state;
    for (let i = curId+1; i <= targId; i++) {
      const aId = this._actions[i];
      const aDoc = this._actionCache[aId];
      for (const a of aDoc.actions) {
        const hooks = _PbemAction.resolve(a.type);
        hooks.forward(state, a);
      }
      this._actionCurrent = aId;
    }
  }

  
  /** Both validate and actually run an action, but no triggers. */
  _actionValidateAndRun(action: PbemActionWithDetails<_PbemAction>) {
    // Try to validate the action; if it passes, send it along.
    const state = this._state;
    
    const hooks = _PbemAction.resolve(action.type);
    if (hooks.validate !== undefined) hooks.validate(state, action);

    // This is a follow-up event on a currently-executing action
    if (hooks.setup !== undefined) hooks.setup(state, action);
    hooks.forward(state, action);
    this._actionGroup!.push(action);
  }


  /** Both validate and run an action, INCLUDING all follow-up actions and 
   * setup() functions. */
  async _actionValidateAndRunWithTriggersAndCommit(
      action: PbemActionWithDetails<_PbemAction>, requestId?: string) {
    const ag: PbemActionWithDetails<_PbemAction>[] = this._actionGroup = [];
    const aprev = this._actionCurrent;
    const state = this._state;
    this._actionValidateAndRun(action);
    try {
      const pbem = new ServerView(this);
      const gameHooks = _GameHooks.State;
      if (gameHooks !== undefined && gameHooks.triggerCheck !== undefined) {
        gameHooks.triggerCheck(pbem);
      }

      // Check if RoundEnd should be triggered
      const pbemHooks = _PbemState.Hooks!;
      pbemHooks.triggerCheck!(pbem);
    }
    catch (e) {
      while (ag.length > 0) {
        const a = ag.pop()!;
        const ahooks = _PbemAction.resolve(a.type);
        ahooks.backward(state, a);
        if (ahooks.validate !== undefined) {
          ahooks.validate(state, a);
        }
      }

      this._actionGroup = undefined;

      throw e;
    }

    // ag now contains all actions in chain; post the chain AFTER adding the
    // event to our queue so it doesn't get executed twice.
    this._actionGroup = undefined;
    const actionId = this._db.getUuid();
    this._actions.push(actionId);
    this._actionCurrent = actionId;
    const actionDoc: DbUserActionDoc = {
      _id: actionId,
      type: 'game-data-action',
      game: this._gameId,
      actions: ag,
      prev: aprev,
    };
    if (requestId !== undefined) {
      actionDoc.request = requestId;
      this._actionRequestNewIds[requestId] = actionId;
    }
    this._actionCache[actionId] = actionDoc;

    // Note that this next part is asynchronous, and so should be after local
    // variable modifications.
    const r = await this._db.put(actionDoc);
  }


  /** Called by host when a new game-response-action is available.  Checks
   * database for all candidate actions, and runs those which should be
   * run.  Keeps going until none found.
   * */
  _gameCheckNextAction() {
    if (this._gameCheckInProgress) return;

    this._gameCheckInProgress = true;
    const p = (async () => {
      while (await this._gameCheckNextAction_step()) {
        // pass
      }
    })();
    p.catch((e) => {
      this._debug(`_gameCheckNextAction: ${e}`);
    });
    p.finally(() => { this._gameCheckInProgress = false; });
  }
  _gameCheckInProgress: boolean = false;

  async _gameCheckNextAction_step(): Promise<boolean> {
    const docs = (await this._db.find({
      selector: {
        game: this._gameId,
        type: 'game-response-action',
      },
    })).docs as DbUserActionRequestDoc[];

    if (docs.length === 0) return false;

    // Priority given based off of action order...
    const docsOrder = docs.map(x => {
      const prev = x.prev;
      const prevMapped = this._actionRequestNewIds[prev];
      const prevId = prevMapped !== undefined ? prevMapped : prev;
      const u = this._actions.indexOf(prevId);
      if (u === -1) return 1e300;
      return [u, x];
    }).sort();

    const doc = docs[0];

    try {
      await this._actionValidateAndRunWithTriggersAndCommit(doc.action, 
          doc._id);
    }
    catch (e) {
      this._debug(`Bad action ${doc._id}: ${e}`);
    }
    finally {
      doc._deleted = true;
      await this._db.put(doc);
    }

    return true;
  }
}


/** Public interface for user code. */
class ServerView implements PbemServerView<_PbemState, _PbemAction> {
  playerId: number = -1;
  get state() { return this._watcher.state; }

  constructor(public _watcher: GamePlayerWatcher) {
  }

  action(action: _PbemAction): void {
    this._watcher.action(action);
  }
}


/** Interface for storing information on actions. */
interface _PbemActionFromDb {
  action: PbemActionWithDetails<_PbemAction>;
}
