
import GameView from './game.vue';

import Vue from 'vue';

export const pbemVuePlugin = {
  install(VueOut: any, options: {}) {
    if (Vue !== VueOut) throw new Error("Not the same");

    Vue.component('pbem-game-view', GameView);
  },
};
