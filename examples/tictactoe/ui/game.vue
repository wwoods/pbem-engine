<template lang="pug">
.game
  table(style="margin-left: auto; margin-right: auto;")
    tr(v-for="j of [0, 1, 2]")
      td(v-for="i of [0, 1, 2]" style="border: solid 1px #000;" @click="$pbem.action('Play', j*3 + i)")
        span {{$pbem.state.game.board[j * 3 + i]}}

  div(v-if="$pbem.hasPending") Waiting on network...
  div {{$pbem.state.settings.players.length}} players in game.
  div(v-if="$pbem.state.game.playerWillWin !== undefined") {{$pbem.state.game.playerWillWin}} will win!
  div
    input(type="button" value="End turn" @click="$pbem.action('PbemAction.TurnEnd')")
  span TODO: gsap animation example.
</template>

<style lang="scss">
  .game > table {
    td {
      width: 2em;
      height: 2em;
    }
  }
</style>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
});
</script>
