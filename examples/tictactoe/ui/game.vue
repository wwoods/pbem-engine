<template lang="pug">
.game
  table(style="margin-left: auto; margin-right: auto;")
    tr(v-for="j of [0, 1, 2]")
      td(v-for="i of [0, 1, 2]" style="border: solid 1px #000;" :class="{lastMove: getLastMove(j*3 + i) !== undefined}" @click="play(j*3 + i)")
        span {{$pbem.state.game.board[j * 3 + i]}}

  div {{$pbem.state.settings.players.reduce((a, b) => a + (b ? 1 : 0), 0)}} players in game.  {{$pbem.playerId}} is active.
    span(:style="{visibility: $pbem.hasPending ? 'visible' : 'hidden', color: 'red'}") &nbsp;Waiting on network...
  div(v-if="$pbem.state.game.playerWillWin !== undefined")
    span {{$pbem.state.game.playerWillWin}}&nbsp;
    span(v-if="$pbem.state.gameEnded") has won!
    span(v-else) will win!
  div
    input(type="button" value="End turn" @click="turnEnd()")
  span TODO: bot support plus locked slots, player turn overlay, bot support
  pbem-event-bar
    template(v-slot:icon="{ ev }")
      span(v-if="ev.type === 'PbemEvent.UserActionError'") !
      span(v-else) ?
    template(v-slot:default="{ ev }")
      span Event content: {{ev.type}}: {{ev.game}}
  pbem-splashscreen-pass-and-play
  div(v-if="$pbem.state.gameEnded" style="position: absolute; left: 0; right: 0; top: 0; bottom: 0; background-color: #000; color: #fff; display: flex; align-items: center; justify-items: center; justify-content: space-around")
    div
      div Game over - {{$pbem.state.game.playerWillWin}} won
      input(type="button" value="Return to menu" @click="$router.push({ name: 'menu' })")
</template>

<style lang="scss">
  .game > table {
    td {
      width: 2em;
      height: 2em;

      &.lastMove {
        color: #f00;
      }
    }
  }
</style>

<script lang="ts">
import Vue from 'vue';

import {PbemEvent} from 'pbem-engine/lib/game';

export default Vue.extend({
  methods: {
    async play(i: number) {
      const g = this.getLastMove(i);
      if (g) {
        await this.$pbem.undo(g);
      }
      else {
        await this.$pbem.action({
          type: 'Play',
          game: { space: i },
        });
      }
    },
    getLastMove(i: number) {
      const a = this.$pbem.getRoundPlayerActions();
      const b = a.filter(x => x.type === 'Play' && x.game.space === i);
      return b.length > 0 ? b[0] : undefined;
    },
    async turnEnd() {
      if (this.$pbem.getRoundPlayerActions().length === 0) {
        this.$pbem.uiEvent('userError', PbemEvent.UserActionError, "haven't done anything");
        return;
      }
      await this.$pbem.action({type: 'PbemAction.TurnEnd', game: {} });
    },
  },
});
</script>
