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

import Vue from 'vue';

import {Settings, State} from '@/game';

export SettingsComponent = Vue.extend({
  props: {
    settings: Object as () => Settings,
  },
  template: `
    .settings
      input(type="checkbox" v-model="settings.game.playerOneIsO") Player 1 is O instead of X
  `,
});



export GameComponent = Vue.extend({
  props: {
    state: Object as () => State,
  },
  template: `
    table
      tr(v-for="j of [0, 1, 2]")
        td(v-for="i of [0, 1, 2]" style="border: solid 1px #000;" @click="$pbem.playerAction('play', j*3 + i)")
          span {{state.game.board[j * 3 + i]}}

    div(v-if="state.game.playerWillWin !== undefined") {{state.game.playerWillWin}} will win!
    div
      input(type="button" @click="$pbem.playerEndTurn") End Turn
    span TODO: gsap animation example.
    //- a(@click="$pbem.playerAction('play', i * 3 + j)") Click to play
    //- Equivalent to $pbem.action($pbem.game.Action.play.create($pbem.state.playerActive, j * 3 + i))
  `,
});

Vue.component('pbem-game-view', GameComponent);
Vue.component('pbem-staging-settings', SettingsComponent);

