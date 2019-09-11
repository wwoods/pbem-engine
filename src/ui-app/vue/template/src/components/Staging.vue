<template lang="pug">
  .pbem-staging
    div(v-if="settings === undefined") Loading...
    template(v-if="settings !== undefined")
      div
        div Players in game
        select(v-model="playersLength")
          option(v-for="n of settings.playersValid" :value="n") {{n}}
        ul
          li(v-for="player of settings.players")
            template(v-if="player !== undefined") {{player.name}}
            span(v-else) Empty slot
        input(type="button" value="Add Pass-and-Play player" @click="playerAddPnp")
          
      pbem-staging-settings(:settings="settings")
      input(type="button" value="Start" @click="startGame")
</template>

<script lang="ts">
import Vue from 'vue';

import {ServerError, ServerLink} from 'pbem-engine/lib/comm';
import {Settings} from '@/game';

export default Vue.extend({
  data() {
    return {
      settings: undefined as Settings | undefined,
    };
  },
  computed: {
    playersLength: {
      get: function(this: any) { return this.settings && this.settings!.players.length; },
      set: function(val) { if (this.settings) { this.settings!.players.length = val; this.settings = Object.assign({}, this.settings); } },
    },
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
      let settings: Settings | undefined, isPastStaging: boolean | undefined;
      try {
        ({settings, isPastStaging} = await ServerLink.stagingLoad<Settings>(
            this.$route.params.id));
      }
      catch (e) {
        if (e instanceof ServerError.NoSuchGameError) {
          this.$router.replace({ name: 'menu' });
        }
        else {
          throw e;
        }
      }
      if (isPastStaging) {
        this.$router.replace({name: 'game', params: {id: this.$route.params.id}});
      }
      else {
        this.settings = settings;
      }
    },
    playerAddPnp() {
      const settings = this.settings;
      if (settings === undefined) return;
      settings.players.push({name: 'locally', online: true});
    },
    async startGame() {
      const settings = this.settings;
      if (settings === undefined) return;
      await ServerLink.stagingStartGame(this.$route.params.id, settings);
      this.$router.replace({name: 'game', params: {id: this.$route.params.id}});
    },
  },
});
</script>

