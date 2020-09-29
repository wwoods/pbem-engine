<template lang="pug">
  .pbem-dev
    h1 PBEM Dev Tools
    p
      div Scenarios:
      ul
        li(v-for="scenario of scenarios")
          a(@click="$router.push({name: 'dev-scenario', params: {scenario}})") {{scenario}}
</template>

<style lang="scss">
  a {
    cursor: pointer;
  }
</style>

<script lang="ts">

import axios from 'axios';
import Vue from 'vue';

export default Vue.extend({
  data() {
    return {
      scenarios: [] as Array<string>,
    }
  },
  async mounted() {
    const r = await axios.get('/dev/scenarios');
    this.scenarios = r.data.scenarios;
  },
});
</script>
