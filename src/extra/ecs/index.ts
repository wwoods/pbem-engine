import {PbemError} from '../../error';
import {PbemState, PbemPlugin} from '../../game';

export interface Ecs {
  // Component name : {entity ID: properties}
  [id: string]: {
    [entity: string]: any,
  };
}


/** Stores component values and the last entity ID created. */
export interface PbemEcsState {
  ecs: Ecs;
  ecsLastId: number;
}


export type PbemEntity = {[key: string]: any};


export interface PbemEcsPlugin<Entity extends PbemEntity> {
  ecs: PbemEcs<Entity>;
  ecsOnCreate?: {(e: PbemEntityWithId<Entity>): void};
  ecsOnUpdate?: {(id: string, component: string, valNew: any, valOld: any): void};
  ecsOnDestroy?: {(e: PbemEntityWithId<Entity>): void};
}

export type PbemEntityWithId<Entity extends PbemEntity> = Entity & {
  id: string,
};


export class PbemEcsNoMatchingEntityError extends PbemError {
  constructor(id: string, ...components: string[]) {
    super(`No ${id} matching ${components}`);
  }
}

const _uiPrefixId = 'ui-';
const _uiPrefixComponent = 'ui_';

/** The ECS system implemented here has two separate but related storage
 * systems: one for permanent objects in the game's state, and one for
 * transient objects used by the UI.  Any component with a name starting 'ui_'
 * will automatically be stored transiently.  Additionally, there is a
 * createUi() function which creates an entity only in the local UI.  To normal
 * game code, there is no distinction, so be careful not to let these elements
 * interact unless desired.
 *
 * It should be impossible for one object to have component data for the same
 * component in both the permanent and UI storages.
 * */
export class PbemEcs<Entity extends PbemEntity> implements PbemPlugin {
  _ecs!: Ecs;
  _plugins: PbemEcsPlugin<Entity>[] = [];

  _ecsUi!: PbemEcsState;

  constructor(public state: PbemState<any, PbemEcsState, any>) {
  }

  init() {
    this.state.game.ecs = this._ecs = {};
    this.state.game.ecsLastId = 0;
    this._ecsUi = {
        ecs: {},
        ecsLastId: 0,
    };
    this.load();
  }

  load() {
  }

  pluginAdd(plugin: PbemEcsPlugin<Entity>) {
    this._plugins.push(plugin);
  }

  pluginRemove(plugin: PbemEcsPlugin<Entity>) {
    const i = this._plugins.indexOf(plugin);
    if (i < 0) throw new PbemError("No such plugin?");
    this._plugins.splice(i, 1);
  }

  /** Actual implementation. */
  create(entity: Entity): string {
    const eResult = entity as PbemEntityWithId<Entity>;
    const ecs = this._ecs;
    this.state.game.ecsLastId++;
    const eid = `${this.state.game.ecsLastId}`;
    eResult.id = eid;
    this._create(eResult);
    return eid;
  }

  createUi(entity: Entity): string {
    const eResult = entity as PbemEntityWithId<Entity>;
    const ecsUi = this._ecsUi;
    ecsUi.ecsLastId++;
    const eid = `${_uiPrefixId}${ecsUi.ecsLastId}`;
    eResult.id = eid;
    this._create(eResult);
    return eid;
  }

  delete(id: string): void {
    const entity = { id } as PbemEntityWithId<Entity>;
    const allEcs = this.isUi(entity) ? [this._ecsUi.ecs] : [
        this._ecs, this._ecsUi.ecs];
    for (const ecs of allEcs) {
      for (const [k, v] of Object.entries(ecs)) {
        const q = v[id];
        if (q !== undefined) {
          (entity as any)[k] = q;
          delete v[id];
        }
      }
    }
    // TEMP reactivity hack
    this._ecsUi.ecs = Object.assign({}, this._ecsUi.ecs);
    this._hook('ecsOnDestroy', entity);
  }

  isUi(entity: PbemEntityWithId<Entity>) {
    return entity.id.startsWith(_uiPrefixId);
  }

  /** Gets component which MUST contain all specified components.  Can add
   * optional components with undefined, e.g.:
   *
   * ecs.get('id', 'tile', undefined, 'maybeA', 'maybeB');
   * */
  get(id: string, ...components: Array<string | undefined>): PbemEntityWithId<Entity> {
    const r: PbemEntityWithId<Entity> = {id} as PbemEntityWithId<Entity>;
    const isUi = this.isUi(r);
    const ecs = isUi ? this._ecsUi.ecs : this._ecs;
    const ecsUi = this._ecsUi.ecs;
    let usingAnd: boolean = true;
    for (const c of components) {
      if (c === undefined) {
        usingAnd = false;
        continue;
      }

      const e = c.startsWith(_uiPrefixComponent) ? ecsUi : ecs;
      const ec = e[c];
      const v = ec ? ec[id] : undefined;
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

  getAll(...components: Array<string | undefined>): PbemEntityWithId<Entity>[] {
    const r: PbemEntityWithId<Entity>[] = [];
    let minLen: number = 1e30;
    let minName: string | undefined;
    for (const c of components) {
      if (c === undefined) {
        break;
      }

      let count: number = 0;

      // Check normal and UI storage
      for (const ecs of [this._ecs, this._ecsUi.ecs]) {
        const ec = ecs[c];
        if (ec === undefined) continue;

        count += Object.keys(ec).length;
      }

      if (count === 0) {
        // If any component doesn't exist, then the final result is always an
        // empty array.
        return r;
      }

      if (count < minLen) {
        minLen = count;
        minName = c;
      }
    }

    if (minName !== undefined) {
      const c1 = this._ecs[minName];
      const c2 = this._ecsUi.ecs[minName];
      const ids1 = c1 !== undefined ? Object.keys(c1) : [];
      const ids2 = c2 !== undefined ? Object.keys(c2) : [];
      const ids = ids1.concat(ids2);
      for (const id of ids) {
        try {
          const rr = this.get(id, ...components);
          r.push(rr);
        }
        catch (e) {
          if (e instanceof PbemEcsNoMatchingEntityError) {
            continue;
          }
          throw e;
        }
      }
    }
    return r;
  }

  update(id: string, components: Entity) {
    const e = components as PbemEntityWithId<Entity>;
    e.id = id;
    const oldVals = this._update(e);

    for (const [k, v] of Object.entries(components)) {
      this._hook('ecsOnUpdate', id, k, v, oldVals[k]);
    }
  }

  _hook(name: string, ...args: any[]) {
    for (const p of this._plugins) {
      (p as any)[name](...args);
    }
  }

  /** Helper function to populate components and call hook.
   * */
  _create(entity: PbemEntityWithId<Entity>): void {
    // TEMP Vue reactivity hack.
    this._ecsUi.ecs = Object.assign({}, this._ecsUi.ecs);
    this._update(entity);
    this._hook('ecsOnCreate', entity);
  }

  /** Update an entity (to game state or UI state appropriately) without
   * calling any hooks.
   * */
  _update(entity: PbemEntityWithId<Entity>): PbemEntityWithId<Entity> {
    const eid = entity.id;
    const ecs = this.isUi(entity) ? this._ecsUi.ecs : this._ecs;
    const ecsUi = this._ecsUi.ecs;
    const old = {id: entity.id} as any;
    for (const [k, v] of Object.entries(entity)) {
      if (k === 'id') continue;
      const e = k.startsWith(_uiPrefixComponent) ? ecsUi : ecs;
      if (!e.hasOwnProperty(k)) e[k] = {};
      const ek = e[k];
      old[k] = ek[eid];
      if (v === undefined) {
        delete ek[eid];
      }
      else {
        ek[eid] = v;
      }
    }
    return old as PbemEntityWithId<Entity>;
  }

}

