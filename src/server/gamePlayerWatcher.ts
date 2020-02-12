
import createDebug from 'debug';
import {EventEmitter} from 'tsee';

import {_GameHooks, _PbemAction, _PbemState, PbemActionWithDetails, 
  PbemActionWithId, PbemPlugin, PbemServerView, PbemAction} from '../game';
import {ServerError, sleep} from '../server/common';
import {DbGame, DbUserActionRequestDoc, DbUserActionDoc, DbGameDoc,
    DbGameStateDoc} from '../server/db';

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
  events = new EventEmitter<{
    // Called on server game daemon shutdown.
    turnEnd: () => void;
  }>();

  get actionIsPending() {
    return this._actionIsPending;
  }
  get isTurnEnded() {
    if (this._actionLatest === this._actionCurrent
        && this._state.turnEnded[this._playerIdx]) {
      return true;
    }
    return false;
  }
  get playerIdx() { return this._playerIdx; }

  // Logger
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

  _actionCurrent!: number;
  _actionIsPending: boolean = false;
  _actionLatest!: number;
  // Cache of all loaded / played / previewed actions...  Note that request
  // docs are inappropriate, as they do not allow for rollback/forward.
  _actionCache: {[key: number]: DbUserActionDoc} = {};

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

    let doc: DbGameStateDoc;
    let retries = 10;
    while (true) {
      const {rows} = await this._db.allDocs({
        include_docs: true,
        startkey: DbGameStateDoc.getIdLast(this._gameId),
        endkey: DbGameStateDoc.getId(this._gameId, 0),
        descending: true,
        limit: 1,
      });
      const docs = rows.map(x => x.doc);

      if (docs.length === 0) {
        if (this._playerIdx !== -1) {
          retries -= 1;
          if (retries > 0) {
            await sleep(300);
            continue;
          }
        }
        throw new ServerError.NoSuchGameError(this._gameId);
      }
      (docs as any).sort((a: DbGameStateDoc, b: DbGameStateDoc) => b.round - a.round);

      doc = docs[0] as DbGameStateDoc;
      break;
    }

    const s = this._state = doc.state;
    this._actionCurrent = doc.actionNext - 1;

    // Load plugins
    if (_GameHooks.State!.plugins) {
      const plugins = _GameHooks.State!.plugins(s);
      s.plugins = plugins;
      for (const p of Object.values(plugins)) {
        (p as PbemPlugin).load();
      }
    }
    else {
      s.plugins = {};
    }
    s.plugins._pbemWatcher = this;

    // Start collecting changes; those which occur before we unset
    // this._initQueue will be buffered, which is OK.
    if (!this._options.noContinuous) {
      const c = this._findCancel = this._db.changes({
        since: 'now',
        live: true,
        include_docs: true,
        selector: {game: this._gameId},
      });
      c.on('change', (change: any) => {
        this.triggerLoadOrChange(change.doc as DbGame);
      });
    }

    // Sets this._actionLatest, creates first RoundStart event if none existing.
    await this._actionLoadLatest();

    // See if we had an outstanding action.
    try {
      const act = await this._db.get(DbUserActionRequestDoc.getId(this._gameId,
          this._playerIdx.toString()));
      if (act !== undefined) {
        this._actionIsPending = true;
      }
    }
    catch (e) {
      if (e.name !== 'not_found') throw e;
    }

    const queue = this._initQueue!;
    delete this._initQueue;

    if (this._playerIdx === -1) {
      // Immediate check for previously pending actions
      this._gameCheckNextAction();
    }
    this._debug('Initialized OK');

    for (const d of queue) {
      this.triggerLoadOrChange(d);
    }
  }

  async action(actionBase: _PbemAction) {
    const aprev = this._actionLatest;
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
      // TODO: offline-capable actions which don't wait on processing.
      const actionId = DbUserActionRequestDoc.getId(this._gameId,
          this._playerIdx.toString());  // this._db.getUuid();
      this._actionIsPending = true;
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
      try {
        const r = await this._db.put(actionDoc);
      }
      catch (e) {
        console.log(e);
        console.log(actionDoc);
        e.docId = actionDoc._id;
        throw e;
      }
    }
  }

  async undo(action: PbemActionWithId<_PbemAction>) {
    await this.action({
      type: 'PbemAction.Undo',
      game: {id: action._id},
    });
  }

  /** Stop watching, prepare for disposal. */
  cancel() {
    if (this._findCancel !== undefined) {
      this._findCancel.cancel();
      this._findCancel = undefined;
    }
  }


  /** Fetch actions performed by the current player during this round, which
   * have not been undone.
   * */
  getRoundPlayerActions(allPlayers?: boolean): PbemActionWithId<_PbemAction>[] {
    // Always fetch actions from perspective of current action.
    let i = this._actionCurrent;
    const r: PbemActionWithId<_PbemAction>[] = [];
    while (i >= 0) {
      const aDoc = this._actionCache[i];
      const a = aDoc.actions[0]! as PbemActionWithDetails<_PbemAction>;
      if (a.type === 'PbemAction.RoundStart' || a.type === 'PbemAction.GameEnd') {
        break;
      }

      if (a.type === 'PbemAction.Undo' || a.locallyUndone) {
        i -= 1;
        continue;
      }

      if (allPlayers || a.playerOrigin === this._playerIdx) {
        const id = aDoc.type === 'game-data-action' 
            ? i
            : aDoc._id!
            ;
        const b = Object.assign({_id: id}, a);
        r.unshift(b);
      }
      i -= 1;
    }

    return r;
  }

  /** A document was changed or loaded; check it. */
  triggerLoadOrChange(doc: DbGame) {
    // When a game document is deleted, we have nothing to do.  Some other
    // change would have happened in tandem.
    if (doc._deleted) {
      if (doc.type === 'game-response-action'
          && doc._id === DbUserActionRequestDoc.getId(this._gameId,
            this._playerIdx.toString())) {
        this._actionIsPending = false;
      }
      return;
    }

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
      const actionId = DbUserActionDoc.getIdFromDoc(doc);
      const upToDate = this._actionCurrent === this._actionLatest;
      this._actionLatest = Math.max(this._actionLatest, actionId);

      this._actionCache[actionId] = doc;

      const actionCurrent = this._actionCurrent;
      if (doc.request !== undefined) {
        // Request can be deleted; was it enacted as-is?
        // TODO

        // Out of order... rollback?
        if (this._actionCurrent > actionId) {
          throw new ServerError.ServerError("Not implemented");
          // Needs to splice action requests, potentially rewrite all requested
          // action indices.
          this._actionRollback(actionId - 1);
        }
      }

      if (actionId < actionCurrent) {
        // Ignore.
        return;
      }

      // Restore previous / current action
      if (upToDate) {
        this._actionRollforward(actionId);
      }
      else {
        this._actionRollforward(actionCurrent);
      }
    }
    else if (doc.type === 'game-response-action') {
      // Requested action...
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
   * Should also load back to RoundStart.  Creates first RoundStart if it does
   * not exist.
   */
  async _actionLoadLatest() {
    this._actionLatest = this._actionCurrent;

    const firstDoc = Math.max(0, this._actionCurrent);
    const currentDocs = await this._db.allDocs({
      startkey: DbUserActionDoc.getId(this._gameId, firstDoc),
      endkey: DbUserActionDoc.getIdLast(this._gameId),
      include_docs: true,
    });
    for (const a of currentDocs.rows) {
      const d = a.doc! as DbUserActionDoc;
      if (d.type !== 'game-data-action') {
        this._debug(`Error: ${d._id} had type ${d.type}`);
      }
      const aId = DbUserActionDoc.getIdFromDoc(d);
      this._actionCache[aId] = d;
      this._actionLatest = Math.max(this._actionLatest, aId);
    }

    // Find earliest RoundStart
    let firstAction = firstDoc;
    while (true) {
      const ac = this._actionCache[firstAction];
      if (ac !== undefined && ac.actions[0].type === 'PbemAction.RoundStart') {
        break;
      }
      else if (firstAction === 0) {
        if (this._playerIdx === -1) {
          // No available RoundStart; make one
          if (this._actionCurrent !== -1) {
            throw new ServerError.ServerError("Not first step, but no RoundStart?");
          }

          await this._actionValidateAndRunWithTriggersAndCommit(
            {
              type: 'PbemAction.RoundStart',
              playerOrigin: -1,
              game: {},
            } as PbemActionWithDetails<PbemAction.Types.RoundStart>);
          this._debug(`Error: no first action which is 'PbemAction.RoundStart'?`);
        }
        break;
      }

      firstAction -= 1;
      const prevAction: DbUserActionDoc = await this._db.get(
        DbUserActionDoc.getId(this._gameId, firstAction));
      this._actionCache[firstAction] = prevAction;
    }

    // Go to latest action.
    this._actionRollforward(this._actionLatest);
  }


  /** Rewind cached actions without validating */
  _actionRollback(id: number) {
    if (this._actionCurrent < id) throw new ServerError.ServerError(
        "Should be rollforward?");

    const state = this._state;
    for (let i = this._actionCurrent-1; i >= id; i--) {
      const aDoc = this._actionCache[i];
      for (let i = aDoc.actions.length - 1; i >= 0; i--) {
        const a = aDoc.actions[i];
        const hooks = _PbemAction.resolve(a.type);
        hooks.backward(state, a);
      }
      this._actionCurrent = i;
    }
  }


  /** Commit cached actions without validating */
  _actionRollforward(id: number) {
    if (this._actionCurrent > id) throw new ServerError.ServerError(
        "Should be rollback?");

    const state = this._state;
    for (let i = this._actionCurrent+1; i <= id; i++) {
      const aDoc = this._actionCache[i];
      for (const a of aDoc.actions) {
        const hooks = _PbemAction.resolve(a.type);
        hooks.forward(state, a);
      }
      this._actionCurrent = i;
    }

    if (this.isTurnEnded) {
      this.events.emit('turnEnd');
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
    if (this._actionCurrent !== this._actionLatest) {
      throw new ServerError.ServerError("Cannot run an action when viewing "
          + "the past.");
    }
    const ag: PbemActionWithDetails<_PbemAction>[] = this._actionGroup = [];
    const aprev = this._actionCurrent;
    const state = this._state;
    this._actionValidateAndRun(action);
    try {
      const pbem = new ServerView(this);
      // Run user hooks
      const gameHooks = _GameHooks.State;
      if (gameHooks !== undefined && gameHooks.triggerCheck !== undefined) {
        gameHooks.triggerCheck(pbem, action);
      }
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
    const actionSeq = aprev + 1;
    const actionId = DbUserActionDoc.getId(this._gameId, actionSeq);
    this._actionCurrent = this._actionLatest = actionSeq;
    const actionDoc: DbUserActionDoc = {
      _id: actionId,
      type: 'game-data-action',
      game: this._gameId,
      actions: ag,
    };
    if (requestId !== undefined) {
      actionDoc.request = requestId;
    }
    this._actionCache[actionSeq] = actionDoc;

    // Note that this next part is asynchronous, and so should be after local
    // variable modifications.
    const r = await this._db.put(actionDoc);

    // Once that's done, see if round should end.
    this._gameCheckNextAction();
  }


  /** Called by host when a new game-response-action is available.  Checks
   * database for all candidate actions, and runs those which should be
   * run.  Keeps going until none found.
   * */
  _gameCheckNextAction() {
    this._debug(`Considering with ${this._gameCheckInProgress}`);
    if (this._gameCheckInProgress) return;
    if (this._playerIdx !== -1) {
      throw new ServerError.ServerError("Only server may check next action");
    }

    this._gameCheckInProgress = true;
    const p = (async () => {
      try {
        while (await this._gameCheckNextAction_step()) {
          // pass
        }
      }
      catch (e) {
        this._debug(`_gameCheckNextAction: ${e}`);
      }
      finally {
        this._gameCheckInProgress = false;
        this._debug(`_gameCheckNextAction: off`);
      }
    })();
  }
  _gameCheckInProgress: boolean = false;

  async _gameCheckNextAction_step(): Promise<boolean> {
    this._debug("_gameCheckNextAction_step()...");
    if (this._state.gameEnded) {
      const doc: DbGameDoc = await this._db.get(this._gameId);
      if (!doc.ended && !doc.ending) {
        doc.ended = true;
        doc.ending = true;
        await this._db.put(doc);
      }
      // Done!
      this._debug("...game ended, exiting");
      return false;
    }

    // First check for round start / end.
    {
      // Check for round end
      let allDone = true;
      const p = this._state.settings.players;
      for (let i = 0, m = p.length; i < m; i++) {
        if (p[i] === undefined) continue;
        allDone = allDone && this._state.turnEnded[i];
      }
      if (allDone) {
        // All ready - advance round.
        await this._actionValidateAndRunWithTriggersAndCommit({
          type: 'PbemAction.RoundStart',
          playerOrigin: -1,
          game: {},
        });
        this._debug("...round started");
        return true;
      }
    }

    // Now check if there was an action request
    const docs = (await this._db.find({
      selector: {
        game: this._gameId,
        type: 'game-response-action',
      },
    })).docs as DbUserActionRequestDoc[];

    if (docs.length === 0) {
      this._debug("...no documents");
      return false;
    }

    // Priority given based off of action order...
    const docsOrder = docs.map(x => {
      return [x.prev, x] as [number, DbUserActionRequestDoc];
    });
    docsOrder.sort();

    const doc = docsOrder[0][1];
    this._debug(`...processing ${doc._id}`);

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
