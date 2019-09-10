<template lang="pug">
  .pbem-game
    span Viewing game {{$route.params.id}}; TODO, $pbem probably won't watch right.
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
        this.state = await ServerLink.gameLoad(this.$route.params.id);
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
