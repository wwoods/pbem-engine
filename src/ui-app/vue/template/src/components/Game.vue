<template lang="pug">
  .pbem-game
    span Viewing game {{$route.params.id}}; TODO, $pbem probably won't watch right.
    div(v-if="!loaded") Loading...
    pbem-game-view(v-if="loaded")
</template>

<script lang="ts">
import Vue from 'vue';
import {ServerLink} from 'pbem-engine/lib/comm';

export default Vue.extend({
  data: function() {
    return {
      loaded: false,
    };
  },
  watch: {
    async '$route.params.id'(val: string) {
      await this.loadGame();
    },
  },
  async mounted() {
    await this.loadGame();
  },
  methods: {
    async loadGame() {
      await ServerLink.gameLoad(this.$route.params.id);
      this.loaded = true;
    },
  },
});
</script>
