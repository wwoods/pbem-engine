<template lang="pug">
  .pbem-menu
    input(type="button" @click="createLocal" value="Create local")
</template>

<script lang="ts">
import Vue from 'vue';

import {ServerLocal} from 'pbem-engine/lib/server/local';
import {PbemSettings} from 'pbem-engine/lib/game';
import {Settings} from '@/game';

export default Vue.extend({
  methods: {
    async createLocal() {
      console.log(this);
      await this.$pbemServer.createLocal(async (s: Settings) => {
        //Local can overwrite ID.
        s.gameId = "TODO";
      });
    },
  },
});
</script>

