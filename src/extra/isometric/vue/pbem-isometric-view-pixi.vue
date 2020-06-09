<template lang="pug">
  .container(v-hammer:pan="onPan" v-hammer:panend="onPan" v-hammer:tap="onTap"
      :vx="vx" :vy="vy" @mousewheel="onMousewheel")
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
import {PbemEntityWithId} from 'pbem-engine/lib/extra/ecs';
import {PbemIsometric, PbemIsometricEntity} from 'pbem-engine/lib/extra/isometric';
import Vue from 'vue';

import * as PIXI from 'pixi.js';

export interface PixiIsometricObject {
  e: PbemEntityWithId<any>;
  /* NOTE it would be best to think about entities, local vs remote, and how this
  render model should shake out.... maybe ecs.local?  Creates storage which is,
  well, local... and
  NOTE no, use a precached entityWithId (not a string) here.  Not necessary to
  get all of it, and we can add PIXI effects without updating any entity, etc
  if we want something special on a select.*/
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
    /** hexMode: If `true`, use hexagons instead of isometric tiles. */
    hexMode: Boolean,
    /** hexRotation: Degrees to rotate tiles before squashing to tileHeight
      */
    hexRotation: Number,
    pixiTypeGetId: Function, //Object as () => {(e: Entity): string},
    pixiTypeFactory: Function, //Object as () => {(id: string): PixiIsometricObject},
    onTapEntity: Function, //{(e: PixiIsometricObject): void}
    startView: String,
    tileWidth: Number,
    tileHeight: Number,
    tileElevation: Number,
  },
  data() {
    return {
      // Viewpoint x, y in screen coordinates (as in `posTileToScreen`)
      vx: 0,
      vy: 0,
      // Viewport scale (<1 to zoom out)
      vscale: 1,
      // ... I think this is stage x, y in screen coordinates
      tx: 0,
      ty: 0,
      // Tile axis 1 and 0; spacing in screen space, divided by
      // tileWidth/tileHeight
      ax1x: 1,
      ax1y: 0,
      ax2x: 0,
      ax2y: -1,
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

    // Determine axes
    if (this.hexMode) {
      const hr = this.hexRotation;
      if (hr < 0 || hr > 60) throw new Error("0 <= hexRotation <= 60");
      const deg2rad = Math.PI * 2 / 360;
      const hexCircleToFlat = Math.cos(30 * deg2rad);
      this.ax1x = Math.cos(-hr * deg2rad) * hexCircleToFlat;
      this.ax1y = Math.sin(-hr * deg2rad) * hexCircleToFlat;
      this.ax2x = Math.cos((-60 - hr) * deg2rad) * hexCircleToFlat;
      this.ax2y = Math.sin((-60 - hr) * deg2rad) * hexCircleToFlat;

      // The difficulty with hexes is determining squish... since we clamp
      // rotation between 0 and 60, and use it as counter-clockwise rotation,
      // we know that width is determined by the 30-degree corner, and height
      // by the 90-degree corner
      const xMax = Math.cos((30 - hr) * deg2rad);
      const yMax = Math.sin((90 - hr) * deg2rad);
      this.ax1x /= xMax;
      this.ax1y /= yMax;
      this.ax2x /= xMax;
      this.ax2y /= yMax;
    }
    else {
      // Isometric
      this.ax1x = 0.5;
      this.ax1y = -0.5;
      this.ax2x = -0.5;
      this.ax2y = -0.5;
    }

    if (this.startView) {
      const p = this.startView.split(',').map(x => parseFloat(x));
      if (p.length !== 2) throw new PbemError(`startView must be form 'x, y'`);
      [this.vx, this.vy] = this._posTileToScreen(p[0], p[1]);
    }

    this.p_renderFrame();
  },
  beforeDestroy() {
    this.alive = false;
    this.$el.removeChild(this._pixi.renderer.view);
    window.removeEventListener('resize', this.onResize);
  },
  computed: {
    elementsVisible() {
      // Screen center
      const hexMode = this.hexMode;

      const scX = this.vx, scY = this.vy, scS = this.vscale;

      const w = this.clientWidth;
      const h = this.clientHeight;
      this.tx = w * 0.5 / scS - scX * this.tileWidth;
      this.ty = h * 0.5 / scS - scY * this.tileHeight;

      const r: Array<{left: number, top: number, zIndex: number, e: any}> = [];

      const ecs = this.$pbem.state.plugins.ecs;
      const iso = this.$pbem.state.plugins.iso as PbemIsometric<any>;
      const comps = this.components.split(' ').filter(x => x.length > 0);

      // Lower-left is min, min
      const ssx = w / this.tileWidth / scS;
      const ssy = h / this.tileHeight / scS;
      const marg_all = 2; // tiles
      const marg_bottom = 5; // tiles; temporary workaround for high elevation
      const llx = this.vx - 0.5 * ssx - marg_all;
      const lly = this.vy + 0.5 * ssy + marg_all + marg_bottom;

      // Compute tile coordinates which would be visible
      const centers = [];
      let tileStart = this._posScreenToTile(llx, lly);
      tileStart = [Math.floor(tileStart[0]), Math.floor(tileStart[1])];

      if (hexMode) {
        // Hex mode; iterate over tiles. Note that ax1 always increases in X,
        // and ax2 always decreases in Y.

        // Choose base tile coordinates, render one row at a time.
        let [tx, ty] = tileStart;
        const [tbx, tby] = this._posTileToScreen(tileStart[0], tileStart[1]);
        let tsx = tbx, tsy = tby;
        while (tsy > tby - (ssy + 2 * marg_all + marg_bottom)) {
          let ttx = tx, tty = ty, ttsx = tsx, ttsy = tsy;
          while (ttsx < tbx + (ssx + 2 * marg_all)) {
            if (ttsy < tsy) {
              // Need to move up a row
              ttx -= 1;
              tty -= 1;
              ttsx += -this.ax1x + -this.ax2x;
              ttsy += -this.ax1y + -this.ax2y;
            }

            centers.push([ttx, tty]);

            ttx += 1;
            ttsx += this.ax1x;
            ttsy += this.ax1y;
          }

          // Move origin tile up and to the left 1
          tx -= 1;
          ty += 1;
          tsx += -this.ax1x + this.ax2x;
          tsy += -this.ax1y + this.ax2y;
        }
      }
      else {
        // Isometric is pretty easy to traverse a given tiles wide and tall
        for (let y = 0, k = ssy + 2 * marg_all + marg_bottom; y < k; y += 0.5) {
          for (let x = 0, m = ssx + 2 * marg_all; x < m; x += 0.5) {
            centers.push([tileStart[0] + x + y, tileStart[1] + y - x]);
          }
        }
      }

      // Resolve tile coordinates to screen objects
      for (const center of centers) {
        for (const e of iso.getEntities(center[0], center[1], undefined,
            ...comps)) {
          const dim = iso.getDimAndMask(e.tile!);

          const p = this._posTileToScreen(dim.sx, dim.sy);
          const w = dim.ex - dim.sx;
          const h = dim.ey - dim.sy;
          let left: number, top: number, z: number;
          if (hexMode && false) {
            throw new Error('TODO: hexRot between 0 and 60 means left/top + w/h can be decided uniquely.');
          }
          else {
            // Isometric
            left = this.tileWidth * (p[0] - 0.5 * h);
            top = this.tileHeight * (p[1] - dim.sz * this.tileElevation - 0.5 * w);
            z = (0xffff
                + Math.round(16 * (-dim.sx - dim.sy + dim.sz * this.tileElevation))
                + (ecs.isUi(e) ? 0x10000 : 0));
          }
          r.push({e, left, top, zIndex: z});
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
        // FIXME -- if you use e.g. the browser back button, and re-join another
        // game, a page refresh is required.  As of 2020-03-21, I am not sure
        // how to circumvent this.
        console.log('quitting render.  refresh if graphics issues after this point');
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
      stage.position.set(this.tx * this.vscale, this.ty * this.vscale);
      stage.scale.set(this.vscale, this.vscale);
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
    onMousewheel(e: any) {
      console.log(e);
      this.vscale *= Math.exp(e.deltaY * -0.01);
      this.vscale = Math.max(0.333, Math.min(2, this.vscale));
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
        this.onTapEntity(v.e);
      }
    },
    /** Note: tile (0, 0) is centered at (0, 0).
      For rendering order efficiency, x increases up and to the right, and y
      increases up and to the left.

      Tile means tile index.

      Screen is orthogonal to display plane, but x should be scaled by
      tileWidth, and y by tileHeight. Hence, Screen.
      */
    _posScreenToTile(x: number, y: number) {
      // x = 1x * tx + 2x * ty
      // y = 1y * tx + 2y * ty
      // det(mat) = 1x * 2y - 2x * 1y
      // inv(mat) = (1 / _) * (2y, -2x, -1y, 1x)
      const a = this.ax1x, b = this.ax2x, c = this.ax1y, d = this.ax2y;
      const detinv = 1 / (a * d - b * c);
      return [
        detinv * (d * x - b * y),
        detinv * (-c * x + a * y),
      ];
    },
    /** Convert tile coordinates to screen-tile coordinates,
      meaning the coordinates returned define the center of the tile
      orthogonally to the viewer. */
    _posTileToScreen(tx: number, ty: number) {
      return [
        this.ax1x * tx + this.ax2x * ty,
        this.ax1y * tx + this.ax2y * ty,
      ];
    }
  },
});
</script>
