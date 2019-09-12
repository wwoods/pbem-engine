<template lang="pug">
  .pbem-staging
    div(v-if="settings === undefined") Loading...
    template(v-if="settings !== undefined")
      div
        div Players in game
        select(v-model="playersLength")
          option(v-for="n of settings.playersValid" :value="n") {{n}}
        .players
          .player(v-for="player, idx of settings.players")
            template(v-if="player !== undefined")
              span {{player.name}}
              input(type="button" value="kick" @click="playerKick(idx)")
            template(v-if="player === undefined")
              span Empty slot
              input(type="button" value="Join as local player" @click="playerLocal(idx)")

      pbem-staging-settings(:settings="settings")
      input(type="button" value="Start" @click="startGame")
</template>

<style lang="scss">
  .pbem-staging {
    .players {
      margin-left: auto;
      margin-right: auto;
      max-width: 30rem;
      justify-content: center;
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;

      .player {
        display: inline-block;
        width: 10em;
        border: solid 1px #000;
        border-radius: 0.5rem;
        margin: 0.1rem;
        padding: 0.2rem;
      }
    }
  }
</style>

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
    playerKick(idx: number) {
      this.settings!.players.splice(idx, 1, undefined);
    },
    playerLocal(idx: number) {
      this.settings!.players.splice(idx, 1, {
        name: `Local ${idx}`,
        index: idx,
      });
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

