<template lang="pug">
  .game
    pbem-isometric-view-pixi(
        :tileWidth="tileWidth" :tileHeight="tileHeight" :tileElevation="tileElevation"
        components="playerPiece boardPiece"
        :pixiTypeGetId="pixiTypeGetId"
        :pixiTypeFactory="pixiTypeFactory"
        startView="8, 8")
      //-
        template(v-slot:default="{ e }")
          //- Already in a {left: ... top: ... z-index: ... position: absolute} setup
          template(v-if="e.playerPiece")
            polygon(points="0,20 40,0 80,20 40,40" fill="blue")
          template(v-else-if="e.boardPiece")
            polygon(points="0,20 40,0 80,20 40,40" fill="red")
          template(v-else)
            polygon(points="0,20 40,0 80,20 40,40" fill="green")
    pbem-event-bar
    pbem-splashscreen-pass-and-play
</template>

<style lang="scss">
</style>

<script lang="ts">
import Vue from 'vue';
import {EcsEntity} from '@/game';

import * as PIXI from 'pixi.js';

const tileWidth = 80;
const tileHeight = 40;
const tileElevation = 0.5;

export type PixiTypeId = 'player' | 'board' | 'unknown';

export default Vue.extend({
  data() {
    return {
      tileWidth, tileHeight, tileElevation,
    };
  },
  computed: {
    $iso() {
      return this.$pbem.state.plugins.iso;
    },
  },
  methods: {
    pixiTypeGetId(e: EcsEntity): PixiTypeId {
      if (e.playerPiece !== undefined) return 'player';
      if (e.boardPiece !== undefined) return 'board';
      return 'unknown';
    },
    pixiTypeFactory(id: PixiTypeId) {
      return {
        player: new PixiIsometricObject(0x00ff00),
        board: new PixiIsometricObject(0xff0000),
        unknown: new PixiIsometricObject(0x0000ff),
      }[id];
    },
  },
});

// TODO formalize interface
export class PixiIsometricObject {
  // Properties populated by the isometric engine
  e!: EcsEntity;
  pixiObject!: PIXI.Container;

  _color: number;

  // Our own texture for this object type
  static _hitArea: {[key: string]: PIXI.Polygon} = {};
  static _texture: {[key: string]: PIXI.Texture} = {};

  constructor(color: number) {
    this._color = color;
  }

  newPixiObject(renderer: PIXI.Renderer) {
    const key = this._color.toString();
    if (PixiIsometricObject._texture[key] === undefined) {
      const w = tileWidth, h = tileHeight, z = tileElevation * tileHeight;
      const tex = PixiIsometricObject._texture[key] = new PIXI.RenderTexture(
          new PIXI.BaseRenderTexture({
            width: w,
            height: h + z
          }));
      const [r, g, b] = PIXI.utils.hex2rgb(this._color);
      const a = 0.4;
      const up = (v: number) => v + (1 - v) * a;
      const down = (v: number) => v * (1 - a);

      const gfx = new PIXI.Graphics();
      gfx.beginFill(PIXI.utils.rgb2hex([r, g, b]))
          .drawPolygon([0, h * 0.5, w * 0.5, 0, w, h * 0.5, w * 0.5, h])
          .endFill();
      gfx.beginFill(PIXI.utils.rgb2hex([up(r), up(g), up(b)]))
          .drawPolygon([0, h * 0.5, 0, z + h * 0.5, w * 0.5, z + h, w * 0.5, h])
          .endFill();
      gfx.beginFill(PIXI.utils.rgb2hex([down(r), down(g), down(b)]))
          .drawPolygon([w, h * 0.5, w, z + h * 0.5, w * 0.5, z + h, w * 0.5, h])
          .endFill();
      renderer.render(gfx, tex);
      PixiIsometricObject._hitArea[key] = new PIXI.Polygon([
          0, h * 0.5, w * 0.5, 0, w, h * 0.5, w, h * 0.5 + z, w * 0.5, h + z,
          0, h * 0.5 + z,
      ]);
    }
    const s = PIXI.Sprite.from(PixiIsometricObject._texture[key]);
    s.hitArea = PixiIsometricObject._hitArea[key];
    return s;
  }

  init() {
    // Set up any e.g. tweening properties based on our new object.
  }

  update(dt: number) {
    // Check for changes in entity state, animate anything, update tweens,
    // whatever.
  }
}

</script>

