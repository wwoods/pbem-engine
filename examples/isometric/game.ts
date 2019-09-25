import {PbemError, PbemEvent, PbemSettings, PbemState, PbemAction} from 'pbem-engine/lib/game';
import {PbemEcs, PbemEcsState} from 'pbem-engine/lib/extra/ecs';
import {PbemIsometric, PbemIsometricEntity} from 'pbem-engine/lib/extra/isometric';

export interface GameSettings {
}
export type Settings = PbemSettings<GameSettings>;
export namespace Settings {
  export const Hooks: PbemSettings.Hooks<Settings> = {
    init(settings) {
      settings.playersValid = [2];
      settings.playersMin = 2;
      settings.version = 1;
    },
  };
}

export interface EcsEntity extends PbemIsometricEntity {
  boardPiece?: {
    type: number;
  };
  playerPiece?: {
    player: number;
    type: number;
  };
}

export interface GameState extends PbemEcsState {
  scores: number[];
}
export type State = PbemState<GameSettings, GameState, {
  ecs: PbemEcs<EcsEntity>,
  iso: PbemIsometric<EcsEntity>,
}>;
export namespace State {
  export const Hooks: PbemState.Hooks<State, Action> = {
    plugins(state) {
      const ecs = new PbemEcs<EcsEntity>(state);
      const iso = new PbemIsometric(state);
      return { ecs, iso };
    },
    init(state) {
      const s = state.settings;
      const g = state.game;

      const ecs = state.plugins.ecs;
      const iso = state.plugins.iso;

      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          ecs.create({
            tile: {
              x,
              y,
              z: 0,
            },
            boardPiece: {
              type: 1,
            },
          });

          if (x >= 16) {
            // One set of board tiles lying on top of the other, just to show
            // we could.
            ecs.create({
              tile: {
                x,
                y,
                z: 1,
              },
              boardPiece: {
                type: 2,
              },
            });
          }
        }
      }
      const startPos = [[8, 8], [24, 24]];
      for (let i = 0, m = s.players.length; i < m; i++) {
        if (s.players[i] === undefined) continue;
        const [x, y] = startPos.shift();
        const z = iso.getMaxZ(x, y, "boardPiece");
        if (z === undefined) throw new PbemError("Bad z?");
        ecs.create({
          tile: {
            x,
            y,
            z: z + 1,
            // TODO s: {
              // undefined for 1x1x1 OR
              // x, y, z, OR
              // mask[][] OR
              // mask[][][]
            //},
          },
          playerPiece: {
            player: i,
            type: 0,
          },
        });
      }

      g.scores = [];
      for (const p of s.players) {
        g.scores.push(0);
      }
    },
  };
}


export type Action = PbemAction.Types.Builtins;
export namespace Action {
  export namespace Types {
    export type Move = PbemAction<'Move', {
      entity: string,
      x: number,
      y: number,
      z: number,
      fromX: number,
      fromY: number,
      fromZ: number,
    }>;
    export const Move: PbemAction.Hooks<State, Move> = {
      init(action, entity: string, x: number, y: number) {
        action.game.entity = entity;
        action.game.x = x;
        action.game.y = y;
      },
      validate(state, action) {
        const entity = state.plugins.ecs.get(action.game.entity, 'tile', 'playerPiece');
        if (entity.playerPiece!.player !== action.playerOrigin) {
          throw new PbemError("Cannot move another player's piece");
        }
        if (Math.abs(entity.tile!.x - action.game.x) > 1
            || Math.abs(entity.tile!.y - action.game.y) > 1) {
          throw new PbemError("Cannot move - too far");
        }

        // Ensure tile not taken
        const ents = state.plugins.iso.getEntities(action.game.x, action.game.y,
            'playerPiece');
        if (ents.length > 0) {
          throw new PbemError("Destination tile occupied");
        }
      },
      setup(state, action) {
        const entity = state.plugins.ecs.get(action.game.entity, 'tile');
        action.game.fromX = entity.tile!.x;
        action.game.fromY = entity.tile!.y;
        action.game.fromZ = entity.tile!.z;

        const maxZ = state.plugins.iso.getMaxZ(action.game.x, action.game.y,
          'boardPiece');
        if (maxZ === undefined) throw new PbemError("No such tile?")
        action.game.z = maxZ + 1;
      },
      forward(state, action) {
        state.plugins.ecs.update(action.game.entity, {
          tile: {
            x: action.game.x,
            y: action.game.y,
            z: action.game.z,
          },
        });
      },
      backward(state, action) {
        state.plugins.ecs.update(action.game.entity, {
          tile: {
            x: action.game.fromX,
            y: action.game.fromY,
            z: action.game.fromZ,
          },
        });
      },
    };
  }
}

