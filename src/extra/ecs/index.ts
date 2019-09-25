import {PbemError} from '../../error';
import {PbemState, PbemPlugin} from '../../game';

export interface Ecs {
  // Component name : {entity ID: properties}
  [id: string]: {
    [entity: string]: any,
  };
}


export interface PbemEcsState {
  ecs: Ecs;
  ecsLastId: number;
}


export interface PbemEcsPlugin<Entity> {
  ecs: PbemEcs<Entity>;
  ecsOnCreate?: {(e: EntityWithId<Entity>): void};
  ecsOnUpdate?: {(id: string, component: string, valNew: any, valOld: any): void};
  ecsOnDestroy?: {(e: EntityWithId<Entity>): void};
}

export type Entity = {[key: string]: any};

export type EntityWithId<EEntity extends Entity> = EEntity & {
  id: string,
};


export class PbemEcsNoMatchingEntityError extends PbemError {
  constructor(id: string, ...components: string[]) {
    super(`No ${id} matching ${components}`);
  }
}


export class PbemEcs<Entity extends {[key: string]: any}> implements PbemPlugin {
  ecs!: Ecs;
  plugins: PbemEcsPlugin<Entity>[] = [];

  constructor(public state: PbemState<any, PbemEcsState, any>) {
  }

  init() {
    this.state.game.ecs = this.ecs = {};
    this.state.game.ecsLastId = 0;
    this.load();
  }

  load() {
  }

  pluginAdd(plugin: PbemEcsPlugin<Entity>) {
    this.plugins.push(plugin);
  }

  /** Actual implementation. */
  create(entity: Entity): string {
    const eResult = entity as EntityWithId<Entity>;
    const ecs = this.ecs;
    this.state.game.ecsLastId++;
    const eid = `${this.state.game.ecsLastId}`;
    eResult.id = eid;
    for (const [k, v] of Object.entries(entity)) {
      if (!ecs.hasOwnProperty(k)) ecs[k] = {};
      ecs[k][eid] = v;
    }
    this._hook('ecsOnCreate', eResult);
    return eid;
  }

  destroy(id: string): void {
    const ecs = this.ecs;
    const entity: Entity = { id } as EntityWithId<Entity>;
    for (const [k, v] of Object.entries(ecs)) {
      const q = v[id];
      if (q !== undefined) {
        (entity as any)[k] = q;
        delete v[id];
      }
    }
    this._hook('ecsOnDestroy', entity);
  }

  /** Gets component which MUST contain all specified components.  Can add
   * optional components with undefined, e.g.:
   *
   * ecs.get('id', 'tile', undefined, 'maybeA', 'maybeB');
   * */
  get(id: string, ...components: Array<string | undefined>): EntityWithId<Entity> {
    const r: EntityWithId<Entity> = {id} as EntityWithId<Entity>;
    const ecs = this.ecs;
    let usingAnd: boolean = true;
    for (const c of components) {
      if (c === undefined) {
        usingAnd = false;
        continue;
      }

      const v = ecs[c][id];
      if (v === undefined) {
        if (usingAnd) {
          // This would be an error.  If we're fetching a component by ID, we
          // should know which components it has, and not need to deal with
          // undefined or null values.
          throw new PbemEcsNoMatchingEntityError(id, c);
        }
      }
      else {
        (r as {[key: string]: any})[c] = v;
      }
    }
    return r;
  }

  getAll(...components: Array<string | undefined>): EntityWithId<Entity>[] {
    const r: EntityWithId<Entity>[] = [];
    const ecs = this.ecs;
    let minLen: number = 1e30;
    let minName: string | undefined;
    for (const c of components) {
      if (c === undefined) {
        break;
      }

      const ec = ecs[c];
      // If any component doesn't exist, then the final result is always an
      // empty array.
      if (ec === undefined) return r;

      const count = Object.keys(ec).length;
      if (count < minLen) {
        minLen = count;
        minName = c;
      }
    }

    if (minName !== undefined) {
      let usingAnd: boolean = true;
      for (const [id, minVal] of Object.entries(ecs[minName])) {
        let rr: EntityWithId<Entity> | undefined = {
            id} as any as EntityWithId<Entity>;
        (rr as any)[minName] = minVal;
        for (const c of components) {
          if (c === minName) continue;
          if (c === undefined) {
            usingAnd = false;
            continue;
          }

          const v = ecs[c][id];
          if (v === undefined) {
            if (usingAnd) {
              rr = undefined;
              break;
            }
          }
          else {
            (rr as any)[c] = v;
          }
        }
        if (rr !== undefined) {
          r.push(rr);
        }
      }
    }
    return r;
  }

  update(id: string, components: Entity) {
    const ecs = this.ecs;
    for (const [k, v] of Object.entries(components)) {
      if (!ecs.hasOwnProperty(k)) ecs[k] = {};

      const valOld = ecs[k][id];
      if (valOld === undefined) {
        this._hook('ecsOnUpdate', id, k, v, valOld);
        ecs[k][id] = v;
      }
      else {
        const valNew = Object.assign(valOld, v);
        this._hook('ecsOnUpdate', id, k, valNew, valOld);
        ecs[k][id] = valNew;
      }
    }
  }

  _hook(name: string, ...args: any[]) {
    for (const p of this.plugins) {
      (p as any)[name](...args);
    }
  }
}

