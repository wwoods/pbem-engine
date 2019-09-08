<template lang="pug">
.game
  table
    tr(v-for="j of [0, 1, 2]")
      td(v-for="i of [0, 1, 2]" style="border: solid 1px #000;" @click="$pbem.playerAction('play', j*3 + i)")
        span {{state.game.board[j * 3 + i]}}

  div(v-if="state.game.playerWillWin !== undefined") {{state.game.playerWillWin}} will win!
  div
    input(type="button" value="End turn" @click="$pbem.playerEndTurn")
  span TODO: gsap animation example.
  //- a(@click="$pbem.playerAction('play', i * 3 + j)") Click to play
  //- Equivalent to $pbem.action($pbem.game.Action.play.create($pbem.state.playerActive, j * 3 + i))
</template>

<script lang="ts">
import Vue from 'vue';

import {State} from '@/game';

export default Vue.extend({
  props: {
    state: Object as () => State,
  },
});
</script>
