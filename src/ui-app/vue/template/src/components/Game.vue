<template lang="pug">
  .pbem-game
    span Viewing game {{$route.params.id}}
    pbem-game-view(:state=state)
</template>

<script lang="ts">
import Vue from 'vue';
import {State} from '@/game';

export default Vue.extend({
  data: function() {
    return {
      state: {} as State,
    };
  },
  watch: {
    '$route.params.id'(val: string) {
      console.log("TODO");
    },
  },
});
</script>
