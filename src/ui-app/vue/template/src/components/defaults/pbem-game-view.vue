<template lang="pug">
  .pbem-game-view
    div Game view: ...
    //- {{$pbem.state}}
    div Player {{$pbem.playerId}}
</template>

<script lang="ts">
import Vue from 'vue';
import {State} from '@/game';

export default Vue.extend({
  mounted() {
    console.log(this.$pbem.state);
  },
});
</script>

