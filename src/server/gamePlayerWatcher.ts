
import {_GameHooks, _PbemState, PbemPlugin} from '../game';
import {ServerError} from '../server/common';
import {DbGame} from '../server/db';

export interface GamePlayerWatcherOptions {
  noInit?: boolean;
}

/** A local viewer for a game.  Responsible for change watching and keeping
 * local state up-to-date by applying / undoing actions.
 * 
 * Also runs the system, when _playerIdx === -1.
 * */
export class GamePlayerWatcher {
  // Database containing game.
  _db: PouchDB.Database<DbGame>;

  // Game ID.
  _gameId: string;

  // Player index (-1 for system)
  _playerIdx: number;

  // State, if loaded in any other phase
  _state!: _PbemState;

  _options: GamePlayerWatcherOptions;
  _findCancel?: PouchDB.FindContinuousCancel;

  get state() { return this._state; }

  constructor(userDb: PouchDB.Database<DbGame>, gameId: string, 
      playerIdx: number, options: GamePlayerWatcherOptions = {}) {
    this._db = userDb;
    this._gameId = gameId;
    this._playerIdx = playerIdx;
    this._options = options;
  }


  /** Start watching, ensure first state is fetched before returning. */
  async init() {
    if (this._options.noInit) {
      throw new ServerError.ServerError("Cannot init() with noInit");
    }

    await new Promise((resolve, reject) => {
      let quitOnGame: boolean = false;
      this._findCancel = this._db.findContinuous(
          {game: this._gameId},
          doc => {
            this.triggerLoadOrChange(doc);
            if (quitOnGame && this._state !== undefined) {
              resolve();
            }
          },
          noMatches => {
            if (this._state !== undefined) {
              resolve();
            }
            else {
              quitOnGame = true;
            }

            // Wait for success, I suppose.
          },
      );
      (this._findCancel as any).on('error', reject);
    });
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
    if (doc.type === 'game-data') {
      console.log('game-data gamePlayerWatcher');
    }
    else if (doc.type === 'game-data-state') {
      if (this._state !== undefined) {
        // Last state should be fine, no need to override.
        return;
      }
      const s = this._state = doc.state;

      // Load plugins
      if (_GameHooks.State!.plugins) {
        const plugins = _GameHooks.State!.plugins(s);
        s.plugins = plugins;
        for (const p of Object.values(plugins)) {
          (p as PbemPlugin).load();
        }
      }
  
    }
    else {
      console.log(`Unhandled gamePlayerWatcher:${doc.type}`);
    }
  }
}

