/** The UI module must provide ...
 *
 * Menu: route to /lobby, /staging, or /game directly.
 *
 * Lobby: The game-selection area.  May be as simple as finding a random
 * challenger.  Should support friends list eventually.  Initially, just random
 * challenger.  Should also have single-player selection items...
 *
 * Staging: The game-setup area.  Earliest stage at which players may join one
 * another.
 *
 * Game: Obvs.
 *
 * PBEM by default specifies all of these components.  They may be replaced by
 * registering Vue components within:
 *
 * pbem-menu
 * pbem-lobby
 * pbem-staging
 *   pbem-staging-settings
 * pbem-game
 *   pbem-game-view
 *
 * */

import SettingsView from './settings.vue';
import GameView from './game.vue';

import Vue from 'vue';

export const pbemVuePlugin = {
  install(VueOut: any, options: {}) {
    if (Vue !== VueOut) {
      console.log(Vue);
      console.log(VueOut);
      throw new Error("NOT THE SAME");
    }
    Vue.component('pbem-staging-settings', SettingsView);
    Vue.component('pbem-game-view', GameView);
  },
};

