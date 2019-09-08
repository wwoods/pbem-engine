<template lang="pug">
.settings
  div
    span Player 1 is O instead of X
    input(type="checkbox" v-model="settings.game.playerOneIsO")
</template>

<script lang="ts">
import Vue from 'vue';

import {Settings} from '@/game';

export default Vue.extend({
  props: {
    settings: Object as () => Settings,
  },
});
</script>

