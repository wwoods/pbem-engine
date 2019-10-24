<template lang="pug">
  .pbem-game
    div(v-if="pbem === undefined") Loading...
    pbem-game-view(v-if="pbem !== undefined")
</template>

<script lang="ts">
import Vue from 'vue';
import {ServerError} from 'pbem-engine/lib/comm';
import {Action, Settings, State} from '@/game';

export default Vue.extend({
  data: function() {
    return {
      pbem: undefined as undefined | any,
    };
  },
  watch: {
    async '$route.params.id'(val: string) {
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
      const id = this.$route.params.id;
      try {
        await this.$pbemServer.gameLoad(id);
      }
      catch (e) {
        if (e instanceof ServerError.NoSuchGameError
            || e instanceof ServerError.NotLoggedInError) {
          this.$router.replace({ name: 'menu' });
        }
        else if (e instanceof ServerError.GameIsStagingError) {
          this.$router.replace({name: 'staging', params: {id}});
        }
        else {
          throw e;
        }
      }

      // So that Vue is aware of the $pbem object,  bind it here to make
      // it reactive.
      this.pbem = this.$pbem;
    },
  },
});
</script>
