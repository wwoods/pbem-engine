<template lang="pug">
  .pbem-staging
    pbem-staging-settings(:settings="settings")
    input(type="button" value="Start" @click="startGame")
</template>

<script lang="ts">
import Vue from 'vue';

import {PbemSettings} from 'pbem-engine/lib/game';
import {Settings} from '@/game';

export default Vue.extend({
  data() {
    const settings: Settings = PbemSettings.create() as Settings;
    Settings.pbemInit(settings);
    return {
      settings,
    };
  },
  methods: {
    startGame() {
      this.$router.push({name: 'game', params: {id: this.$route.params.id}});
    },
  },
});
</script>

