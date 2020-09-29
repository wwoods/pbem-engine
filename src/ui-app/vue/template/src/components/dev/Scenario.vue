<template lang="pug">
  .pbem-dev-scenario
    div(v-if="pbem === undefined") Loading...
    pbem-game-view(v-if="pbem !== undefined")
</template>

<script lang="ts">

import axios from 'axios';
import Vue from 'vue';

export default Vue.extend({
  data: function() {
    return {
      pbem: undefined as undefined | any,
    };
  },
  watch: {
    async '$route.params.scenario'(val: string) {
      await this.loadGame();
    },
  },
  async mounted() {
    await this.$pbemServer.readyEvent;
    await this.loadGame();
  },
  beforeDestroy() {
    this.$pbemServer.gameUnload();
  },
  methods: {
    async loadGame() {
      this.pbem = undefined;

      const id = this.$route.params.scenario;
      const scenData = await axios.get('/dev/scenario',
          {params: {scenario: id}});
      try {
        await this.$pbemServer.gameLoadScenario(scenData.data.scenario);
      }
      catch (e) {
        throw e;
      }

      // Loaded OK; bind game state and make it reactive.
      this.pbem = this.$pbem;
    },
  },
});

</script>
