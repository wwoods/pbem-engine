<template lang="pug">
  .pbem-game-view
    div Game view: {{state}}
    div Player {{state.playerActive}}
</template>

<script lang="ts">
import Vue from 'vue';
import {State} from '@/game';

export default Vue.extend({
  props: {
    state: Object as () => State,
  },
});
</script>

