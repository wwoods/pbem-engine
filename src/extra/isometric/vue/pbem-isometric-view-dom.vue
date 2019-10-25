<template lang="pug">
  svg.pbem-isometric-view-dom(v-touch:moved="panStart" v-touch:moving="panMove" v-touch:end="panEnd")
    g.parent(:transform="`scale(${vscale}) translate(${tx} ${ty})`")
      template(v-for="eDesc of elementsVisible")
        g.obj(:key="eDesc.e.id" :transform="'translate(' + eDesc.left + ' ' + eDesc.top + ')'" :tile="`${eDesc.e.tile.x}, ${eDesc.e.tile.y}`")
          slot(:e="eDesc.e")
            span {{eDesc.e.id}}
</template>

<style scoped lang="scss">
.pbem-isometric-view-dom {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  transform: translate3d(0, 0, 0);
}
</style>

<script lang="ts">
import {PbemError} from 'pbem-engine/lib/error';
import {PbemIsometric} from 'pbem-engine/lib/extra/isometric';
import Vue from 'vue';

export default Vue.extend({
  props: {
    components: String,
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
      _panActive: false,
      _panStartX: 0,
      _panStartY: 0,
      _panStartVx: 0,
      _panStartVy: 0,
    };
  },
  watch: {
  },
  mounted() {
    this.onResize();
    window.addEventListener('resize', this.onResize);

    if (this.startView) {
      const p = this.startView.split(',').map(x => parseFloat(x));
      if (p.length !== 2) throw new PbemError(`startView must be form 'x, y'`);
      [this.vx, this.vy] = this._posTileToScreen(p[0], p[1]);
    }
  },
  beforeDestroy() {
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
      const llx = this.vx - 0.5 * ssx;
      const lly = this.vy + 0.5 * ssy;

      const centers = [];
      let tileStart = this._posScreenToTile(llx, lly);
      tileStart = [Math.floor(tileStart[0]), Math.floor(tileStart[1])];
      console.log(tileStart);
      console.log(ssx);
      console.log(ssy);
      for (let x = 0, m = ssx + 1; x < m; x += 0.5) {
        for (let y = 0, k = ssy + 1; y < k; y += 0.5) {
          centers.push([tileStart[0] + x + y, tileStart[1] + x - y]);
        }
      }
      for (const center of centers) {
        for (const e of iso.getEntities(center[0], center[1], undefined,
            ...comps)) {
          const dim = iso.getDimAndMask(e.tile!);
          //if (dim.sx !== center[0] || dim.sy !== center[1]) continue;

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
      r.sort((a, b) => a.zIndex - b.zIndex);
      return r;
    },
  },
  methods: {
    onResize() {
      this.clientWidth = this.$el.clientWidth;
      this.clientHeight = this.$el.clientHeight;
    },
    panStart(e: any) {
      this._panActive = true;
      const ee = e.touches ? e.touches[0] : e;
      this._panStartX = ee.pageX;
      this._panStartY = ee.pageY;
      this._panStartVx = this.vx;
      this._panStartVy = this.vy;
    },
    panMove(e: any) {
      if (this._panActive) {
        const ee = e.touches ? e.touches[0] : e;
        const dx = ee.pageX - this._panStartX;
        const dy = ee.pageY - this._panStartY;
        this.vx = this._panStartVx - dx / this.tileWidth / this.vscale;
        this.vy = this._panStartVy - dy / this.tileHeight / this.vscale;
      }
    },
    panEnd(e: any) {
      this._panActive = false;
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

