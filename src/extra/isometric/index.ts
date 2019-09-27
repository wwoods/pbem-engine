import {PbemEcs, PbemEcsState, PbemEcsPlugin, PbemEntityWithId, PbemEcsNoMatchingEntityError} from '../ecs';
import {PbemError} from '../../error';
import {PbemPlugin, PbemState} from '../../game';

export type TileSizeBox = {
  x: number;
  y: number;
  z: number;
};
export type TileSizeMask = boolean[][][];
export type TileData = {
  x: number;
  y: number;
  z: number;
  s?: TileSizeBox | TileSizeMask;
};
export interface PbemIsometricEntity {
  tile?: TileData;
}


export class PbemIsometric<Entity extends PbemIsometricEntity> implements PbemPlugin, PbemEcsPlugin<Entity> {
  ecs!: PbemEcs<Entity>;
  _tileMap = new Map<string, Set<string>>();

  constructor(public state: PbemState<any, PbemEcsState, {ecs: PbemEcs<Entity>}>) {}

  init() {
    this.load();
  }

  load() {
    this.ecs = this.state.plugins.ecs;
    this.ecs.pluginAdd(this);

    for (const e of this.ecs.getAll('tile')) {
      this._objAdd(e);
    }
  }

  ecsOnCreate(e: PbemEntityWithId<Entity>) {
    if (e.tile === undefined) return;

    this._objAdd(e);
  }

  ecsOnUpdate(id: string, component: string, valNew: any, valOld: any) {
    if (component !== 'tile') return;

    const oldE: PbemEntityWithId<Entity> = { id, tile: valOld } as PbemEntityWithId<Entity>;
    const e: PbemEntityWithId<Entity> = { id, tile: valNew } as PbemEntityWithId<Entity>;
    this._objRemove(oldE);
    this._objAdd(e);
  }

  ecsOnDestroy(e: PbemEntityWithId<Entity>) {
    if (e.tile === undefined) return;
    this._objRemove(e);
  }

  getEntities(x: number, y: number, ...components: Array<string | undefined>): PbemEntityWithId<Entity>[] {
    const r: PbemEntityWithId<Entity>[] = [];

    const coord = `${x},${y}`;
    const m = this._tileMap.get(coord);
    if (m === undefined) return r;

    const ecs = this.ecs;
    for (const eId of m) {
      try {
        const e = ecs.get(eId, 'tile', ...components);
        r.push(e);
      }
      catch (e) {
        if (e instanceof PbemEcsNoMatchingEntityError) {
          continue;
        }
        throw e;
      }
    }

    return r;
  }

  getMaxZ(x: number, y: number, ...components: string[]): number | undefined {
    const ents = this.getEntities(x, y, ...components);
    let z: number | undefined;
    for (const e of ents) {
      const eDim = this.getDimAndMask(e.tile!);
      if (z === undefined || eDim.ez > z) {
        z = eDim.ez - 1;
      }
    }
    return z;
  }

  getDimAndMask(tile: TileData): {sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, mask: TileSizeMask | undefined} {
    const x1 = tile.x;
    const y1 = tile.y;
    const z1 = tile.z;
    if (tile.s === undefined) {
        return {
          sx: x1,
          sy: y1,
          sz: z1,
          ex: x1 + 1,
          ey: y1 + 1,
          ez: z1 + 1,
          mask: undefined,
        };
    }
    else {
      if (tile.s.hasOwnProperty('x')) {
        // Size information
        const s = tile.s as TileSizeBox;
        return {
          sx: x1,
          sy: y1,
          sz: z1,
          ex: x1 + s.x,
          ey: y1 + s.y,
          ez: z1 + s.z,
          mask: undefined,
        };
      }
      else {
        throw new PbemError("Not implemented: getDimAndMask() with mask");
      }
    }
    throw new PbemError("Fell out the bottom");
  }

  _objAdd(e: PbemEntityWithId<Entity>) {
    const tile = e.tile!;

    const dims = this.getDimAndMask(tile);
    for (let y = dims.sy; y < dims.ey; y++) {
      for (let x = dims.sx; x < dims.ex; x++) {
        this._tmAdd(x, y, e.id);
      }
    }
  }

  _objRemove(e: PbemEntityWithId<Entity>) {
    const tile = e.tile!;

    const dims = this.getDimAndMask(tile);
    for (let y = dims.sy; y < dims.ey; y++) {
      for (let x = dims.sx; x < dims.ex; x++) {
        this._tmRemove(x, y, e.id);
      }
    }
  }

  _tmAdd(x: number, y: number, id: string) {
    const coord = `${x},${y}`;
    let v = this._tileMap.get(coord);
    if (v === undefined) {
      v = new Set<string>();
      this._tileMap.set(coord, v);
    }
    v.add(id);
  }

  _tmRemove(x: number, y: number, id: string) {
    const coord = `${x},${y}`;
    let v = this._tileMap.get(coord);
    if (v !== undefined) {
      v.delete(id);
    }
  }
}

