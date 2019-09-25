<template lang="pug">
  .container(v-hammer:pan="onPan" v-hammer:panend="onPan" v-hammer:tap="onTap" :vx="vx" :vy="vy")
</template>

<style scoped lang="scss">
  .container {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>

<script lang="ts">
import {PbemError} from 'pbem-engine/lib/error';
import {Entity} from 'pbem-engine/lib/extra/ecs';
import {PbemIsometric, PbemIsometricEntity} from 'pbem-engine/lib/extra/isometric';
import Vue from 'vue';

import * as PIXI from 'pixi.js';

export interface PixiIsometricObject {
  e: PbemIsometricEntity;
  pixiObject: PIXI.Container;
  typeId: string;

  newPixiObject(renderer: PIXI.Renderer): PIXI.Container;
  init(): void;
  update(dt: number): void;
}

export interface PixiData {
  renderer: PIXI.Renderer,
  stage: PIXI.Container,
  renderTime: number,
  spriteActive: {[id: string]: PixiIsometricObject},
  spritePool: {[typeId: string]: PixiIsometricObject[]},
}

export default Vue.extend({
  props: {
    components: String,
    pixiTypeGetId: Function, //Object as () => {(e: Entity): string},
    pixiTypeFactory: Function, //Object as () => {(id: string): PixiIsometricObject},
    startView: String,
    tileWidth: Number,
    tileHeight: Number,
    tileElevation: Number,
  },
  data() {
    return {
      vx: 0,
      vy: 0,
      tx: 0,
      ty: 0,
      vscale: 1,
      clientWidth: 0,
      clientHeight: 0,
      alive: false,
      _panActive: false,
      _panStartVx: 0,
      _panStartVy: 0,
      // I *think* this stops Vue from tracking the Pixi data.
      _pixi: undefined as any as PixiData,
    };
  },
  watch: {
  },
  mounted() {
    this.alive = true;
    this._pixi = {
      renderer: new PIXI.Renderer({ width: 800, height: 600 }),
      stage: new PIXI.Container(),
      renderTime: Date.now(),
      spriteActive: {},
      spritePool: {},
    };
    this._pixi.stage.sortableChildren = true;
    this.onResize();
    window.addEventListener('resize', this.onResize);
    this.$el.appendChild(this._pixi.renderer.view);

    if (this.startView) {
      const p = this.startView.split(',').map(x => parseFloat(x));
      if (p.length !== 2) throw new PbemError(`startView must be form 'x, y'`);
      [this.vx, this.vy] = this._posTileToScreen(p[0], p[1]);
    }

    this.p_renderFrame();
  },
  beforeDestroy() {
    this.alive = false;
    window.removeEventListener('resize', this.onResize);
  },
  computed: {
    elementsVisible() {
      // Screen center
      const scX = this.vx, scY = this.vy, scS = this.vscale;

      const w = this.clientWidth;
      const h = this.clientHeight;
      this.tx = w * 0.5 / scS - scX * this.tileWidth;
      this.ty = h * 0.5 / scS - scY * this.tileHeight;

      const r: Array<{left: number, top: number, zIndex: number, e: any}> = [];

      const iso = this.$pbem.state.plugins.iso as PbemIsometric<any>;
      const comps = this.components.split(' ').filter(x => x.length > 0);

      // Lower-left is min, min
      const ssx = w / this.tileWidth / scS;
      const ssy = h / this.tileHeight / scS;
      const marg_all = 2; // tiles
      const marg_bottom = 5; // tiles; temporary workaround for high elevation
      const llx = this.vx - 0.5 * ssx - marg_all;
      const lly = this.vy + 0.5 * ssy + marg_all + marg_bottom;

      const centers = [];
      let tileStart = this._posScreenToTile(llx, lly);
      tileStart = [Math.floor(tileStart[0]), Math.floor(tileStart[1])];
      for (let y = 0, k = ssy + 2 * marg_all + marg_bottom; y < k; y += 0.5) {
        for (let x = 0, m = ssx + 2 * marg_all; x < m; x += 0.5) {
          centers.push([tileStart[0] + x + y, tileStart[1] + y - x]);
        }
      }
      for (const center of centers) {
        for (const e of iso.getEntities(center[0], center[1], undefined,
            ...comps)) {
          const dim = iso.getDimAndMask(e.tile!);
          if (dim.sx !== center[0] || dim.sy !== center[1]) continue;

          const p = this._posTileToScreen(dim.sx, dim.sy);
          const w = dim.ex - dim.sx;
          const h = dim.ey - dim.sy;
          r.push({
            e,
            left: this.tileWidth * (p[0] - 0.5 * h),
            top: this.tileHeight * (p[1] - dim.sz * this.tileElevation - 0.5 * w),
            zIndex: 0xffff + Math.round(-dim.sx - dim.sy + dim.sz * this.tileElevation),
          });
        }
      }
      return r;
    },
  },
  methods: {
    onResize() {
      this.clientWidth = this.$el.clientWidth;
      this.clientHeight = this.$el.clientHeight;
      this._pixi.renderer.resize(this.clientWidth, this.clientHeight);
    },
    p_renderFrame() {
      if (!this.alive) {
        console.log('quitting render');
        return;
      }
      requestAnimationFrame(this.p_renderFrame);

      const now = Date.now();
      const last = this._pixi.renderTime;
      this._pixi.renderTime = now;
      const dt = 1e-3 * Math.max(0, Math.min(1000, now - last));
      const stage = this._pixi.stage;
      const renderer = this._pixi.renderer;

      const els = this.elementsVisible;
      stage.position.set(this.tx, this.ty);
      const sa = this._pixi.spriteActive;
      const unseenIds = new Set<string>(Object.keys(sa));
      const sp = this._pixi.spritePool;
      for (const e of els) {
        const eId = e.e.id;
        let v: PixiIsometricObject | undefined = sa[eId];
        if (v !== undefined) {
          unseenIds.delete(eId);
          v.e = e.e;
          v.update(dt);
        }
        else {
          const type = this.pixiTypeGetId(e.e);
          const free = sp[type];
          if (free !== undefined) {
            v = free.pop();
          }
          if (v === undefined) {
            v = this.pixiTypeFactory(type);
          }

          sa[eId] = v!;

          v!.e = e.e;
          if (v!.pixiObject === undefined) {
            v!.pixiObject = v!.newPixiObject(renderer);
            (v!.pixiObject as any).userData = v;
            v!.pixiObject.interactive = true;
          }
          v!.init();
          stage.addChild(v!.pixiObject);
        }

        v!.pixiObject.position.set(e.left, e.top);
        v!.pixiObject.zIndex = e.zIndex;
      }

      for (const id of unseenIds) {
        const v = sa[id]!;
        delete sa[id];
        delete v.e;

        v.pixiObject.parent.removeChild(v.pixiObject);
        let free = sp[v.typeId];
        if (free === undefined) {
          free = sp[v.typeId] = [];
        }
        free.push(v);
      }

      this._pixi.renderer.render(stage);
    },
    onPan(e: any) {
      if (!this._panActive) {
        this._panActive = true;
        this._panStartVx = this.vx;
        this._panStartVy = this.vy;
      }

      this.vx = this._panStartVx - e.deltaX / this.tileWidth / this.vscale;
      this.vy = this._panStartVy - e.deltaY / this.tileHeight / this.vscale;

      if (e.type === 'panend') {
        this._panActive = false;
      }
    },
    onTap(e: any) {
      const pt = e.center;
      const pixiPt = new PIXI.Point();
      const interactionManager = this._pixi.renderer.plugins.interaction;
      interactionManager.mapPositionToPoint(pixiPt, pt.x, pt.y);
      const pixiObj = interactionManager.hitTest(pixiPt, this._pixi.stage);
      if (pixiObj !== undefined && pixiObj !== null) {
        const v = (pixiObj as any).userData as PixiIsometricObject;
        const t = v.e.tile!;
        console.log(`Tapped ${t.x}, ${t.y}, ${t.z}`);
      }
    },
    /** Note: tile (0, 0) is centered at (0, 0).
      For rendering order efficiency, x increases up and to the right, and y
      increases up and to the left.

      Tile means tile index.

      Screen is orthogonal to display plane, but x should be scaled by
      tileWidth, and y by tileHeight.
      */
    _posScreenToTile(x: number, y: number) {
      return [
        x - y,
        -(x + y),
      ];
    },
    _posTileToScreen(tx: number, ty: number) {
      return [
        0.5 * (tx - ty),
        0.5 * (-tx - ty),
      ];
    }
  },
});
</script>
