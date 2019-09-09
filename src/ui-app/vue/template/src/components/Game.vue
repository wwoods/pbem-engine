<template lang="pug">
  .pbem-game
    span Viewing game {{$route.params.id}}; TODO, $pbem probably won't watch right.
    div(v-if="!loaded") Loading...
    pbem-game-view(v-if="loaded")
</template>

<script lang="ts">
import Vue from 'vue';
import {ServerError, ServerLink} from 'pbem-engine/lib/comm';

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
      try {
        await ServerLink.gameLoad(this.$route.params.id);
        this.loaded = true;
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
