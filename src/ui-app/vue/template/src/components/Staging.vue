<template lang="pug">
  .pbem-staging
    div(v-if="settings === undefined") Loading...
    template(v-if="settings !== undefined")
      pbem-staging-settings(:settings="settings")
      input(type="button" value="Start" @click="startGame")
</template>

<script lang="ts">
import Vue from 'vue';

import {ServerLink} from 'pbem-engine/lib/comm';
import {Settings} from '@/game';

export default Vue.extend({
  data() {
    return {
      settings: undefined as Settings | undefined,
    };
  },
  watch: {
    async '$route.params.id'(val) {
      await this.loadSettings();
    },
    settings: {
      handler(val) {
        console.log("Should update server");
      },
      deep: true,
    },
  },
  async mounted() {
    await this.loadSettings();
  },
  methods: {
    async loadSettings() {
      this.settings = undefined;
      const {settings, isPastStaging} = await ServerLink.stagingLoad<Settings>(
          this.$route.params.id);
      if (isPastStaging) {
        this.$router.replace({name: 'game', params: {id: this.$route.params.id}});
      }
      else {
        this.settings = settings;
      }
    },
    async startGame() {
      const settings = this.settings;
      if (settings === undefined) return;
      await ServerLink.stagingStartGame(this.$route.params.id, settings);
      this.$router.push({name: 'game', params: {id: this.$route.params.id}});
    },
  },
});
</script>

