<template lang="pug">
  svg.pbem-isometric-view-dom
    g.parent(:transform="'scale(' + vscale + ')'")
      template(v-for="eDesc of elementsVisible")
        g.obj(:transform="'translate(' + eDesc.left + ' ' + eDesc.top + ')'")
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
}
</style>

<script lang="ts">
import {PbemIsometric} from 'pbem-engine/lib/extra/isometric';
import Vue from 'vue';

export default Vue.extend({
  props: {
    components: String,
    tileWidth: Number,
    tileHeight: Number,
    tileElevation: Number,
  },
  data() {
    const p = this._posTileToScreen(8, 8);
    return {
      vx: p[0],
      vy: p[1],
      vscale: 1,
      clientWidth: 0,
      clientHeight: 0,
    };
  },
  watch: {
  },
  mounted() {
    this.onResize();
    window.addEventListener('resize', this.onResize);
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.onResize);
  },
  computed: {
    elementsVisible() {
      // Screen center
      const scX = this.vx, scY = this.vy, scS = this.vscale;
      //const center = [0, 0]; // TODO this._posScreenToTile(scX, scY);

      const w = this.clientWidth;
      const h = this.clientHeight;
      const tx = w * 0.5 / scS - scX * this.tileWidth;
      const ty = h * 0.5 / scS - scY * this.tileHeight;

      const r: Array<{left: number, top: number, zIndex: number, e: any}> = [];

      const iso = this.$pbem.state.plugins.iso as PbemIsometric<any>;
      const comps = this.components.split(' ').filter(x => x.length > 0);
      const centers = [];
      for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 32; y++) {
          centers.push([x, y]);
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
            left: this.tileWidth * (p[0] - 0.5 * h) + tx,
            top: this.tileHeight * (p[1] - dim.sz * this.tileElevation - 0.5 * w) + ty,
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
    /** Note: tile (0, 0) is centered at (0, 0).
      For rendering order efficiency, x increases up and to the right, and y
      increases up and to the left.

      Tile means tile index.

      Screen is orthogonal to display plane, but x should be scaled by
      tileWidth, and y by tileHeight.
      */
    _posScreenToTile(x: number, y: number) {
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

