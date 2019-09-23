<template lang="pug">
  .pbem-game
    div(v-if="state === undefined") Loading...
    pbem-game-view(v-if="state !== undefined")
</template>

<script lang="ts">
import Vue from 'vue';
import {ServerError, ServerLink} from 'pbem-engine/lib/comm';
import {State} from '@/game';

export default Vue.extend({
  data: function() {
    return {
      state: undefined as undefined | State,
      pbem: undefined as undefined | any,
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
      try {
        this.state = await ServerLink.gameLoad<any>(this.$route.params.id);
        // So that Vue is aware of the $pbem object,  bind it here to make
        // it reactive.
        this.pbem = this.$pbem;
      }
      catch (e) {
        const q = new ServerError.NoSuchGameError('hi');
        if (e instanceof ServerError.NoSuchGameError) {
          this.$router.replace({ name: 'menu' });
        }
        else if (e instanceof ServerError.GameIsStagingError) {
          this.$router.replace({ name: 'staging', params: {
              id: this.$route.params.id } });
        }
        else {
          throw e;
        }
      }
    },
  },
});
</script>
