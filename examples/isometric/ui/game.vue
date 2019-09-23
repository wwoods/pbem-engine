<template lang="pug">
  .game
    pbem-isometric-view-dom(:tileWidth="80" :tileHeight="40" :tileElevation="0.5" components="playerPiece boardPiece")
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

export default Vue.extend({
  computed: {
    $iso() {
      return this.$pbem.state.plugins.iso;
    },
  },
});
</script>

