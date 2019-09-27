<template lang="pug">
  .game
    pbem-isometric-view-pixi(#pixiUi
        :tileWidth="tileWidth" :tileHeight="tileHeight" :tileElevation="tileElevation"
        :onTapEntity="onTapEntity"
        components="playerPiece boardPiece ui_shine"
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
import {Action, EcsEntity, EcsEntityWithId} from '@/game';

import {PbemEcs, PbemEcsPlugin} from 'pbem-engine/lib/extra/ecs';
import * as PIXI from 'pixi.js';
import {GlowFilter} from 'pixi-filters';
import Vue from 'vue';

const tileWidth = 80;
const tileHeight = 40;
const tileElevation = 0.5;

export type PixiTypeId = 'player' | 'board' | 'unknown';

export class Plugin implements PbemEcsPlugin<EcsEntity> {
  ecs!: PbemEcs<EcsEntity>;

  ecsOnCreate(e: EcsEntityWithId) {
  }

  ecsOnUpdate(id: string, component: string, valNew: any, valOld: any) {
    if (component !== 'ui_selected') {
      return;
    }

    const e = this.ecs.get(id, undefined, 'tile', 'playerPiece');
    if (e.playerPiece !== undefined) {
      const t = e.tile!;

      // Pixi containers are transient, so we don't want to interact with the
      // pixi container directly.
      this.ecs.update(e.id, {
        ui_shine: true,
      });

      this.ecs.createUi({
        tile: {
          x: t.x + 1,
          y: t.y,
          z: t.z,
        },
        ui_target: {
          type: 'action',
          args: ['Move', e.id, t.x + 1, t.y],
        },
      });
    }
  }

  ecsOnDestroy(e: EcsEntityWithId) {
  }
}

export default Vue.extend({
  data() {
    return {
      tileWidth, tileHeight, tileElevation,
      pixiUi: undefined as any,
      ecsPlugin: new Plugin(),
    };
  },
  computed: {
    $ecs() {
      return this.$pbem.state.plugins.ecs;
    },
    $iso() {
      return this.$pbem.state.plugins.iso;
    },
  },
  mounted() {
    this.ecsPlugin.ecs = this.$ecs;
    this.$ecs.pluginAdd(this.ecsPlugin);
  },
  beforeDestroy() {
    this.$ecs.pluginRemove(this.ecsPlugin);
  },
  methods: {
    onTapEntity(e: EcsEntityWithId) {
      const et = e.tile!;
      const ecs = this.$ecs;
      const iso = this.$iso;

      let stack = iso.getEntities(et.x, et.y, undefined, 'ui');

      // ui elements have preference
      const stack_ui = stack.filter(a => ecs.isUi(a));
      if (stack_ui.length > 0) {
        stack = stack_ui;

        this.onTapUi(stack[0].id);
      }
      else {
        stack.sort((a, b) => b.tile!.z - a.tile!.z);

        // if there's a current selection, select below it.
        const curSel = this.$ecs.getAll('ui_selected', 'tile');
        if (curSel.length > 0
            && et.x === curSel[0].tile!.x
            && et.y === curSel[0].tile!.y) {
            const z = curSel[0].tile!.z;
          stack = stack.filter(a => a.tile!.z < z);
        }

        // Didn't tap on a UI element, at least.
        this.onTapUi(undefined);

        // Unset previous selection before setting new one
        for (const c of curSel) {
          this.$ecs.update(c.id, {ui_selected: undefined});
        }
      }

      // select the new element.
      if (stack.length > 0) {
        this.$ecs.update(stack[0].id, {ui_selected: true});
      }
    },
    onTapUi(id: string | undefined) {
      if (id !== undefined) {
        const e = this.$ecs.get(id, 'ui_target');
        // TODO see how Vue gets around this, and if there's a way to ease the
        // user's troubles.
        if (e.ui_target!.type === 'action') {
          // Typescript would complain about 0 or more arguments instead of
          // 1 or more, but we know this next line is fine.
          // @ts-ignore
          this.$pbem.action(...e.ui_target!.args);
        }
      }

      for (const o of this.$ecs.getAll('tile', 'ui_target')) {
        this.$ecs.delete(o.id);
      }
    },
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
  e!: EcsEntityWithId;
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
    this.pixiObject.filters = [];
  }

  update(dt: number) {
    // Check for changes in entity state, animate anything, update tweens,
    // whatever.
    if (this.e.ui_shine) {
      if (this.pixiObject.filters.length === 0) {
        this.pixiObject.filters = [
          new GlowFilter(),
        ];
        this.pixiObject.filters[0].padding = 20;
      }
    }
    else if (this.pixiObject.filters.length > 0) {
      this.pixiObject.filters = [];
    }
  }
}

</script>

