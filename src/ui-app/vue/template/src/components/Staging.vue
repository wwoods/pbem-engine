<template lang="pug">
  .pbem-staging
    div(v-if="settings === undefined") Loading...
    template(v-if="settings !== undefined")
      div
        div Players in game
        select(v-model="playersLength" :disabled="!isHost")
          option(v-for="n of settings.playersValid" :value="n") {{n}}
        .players
          .player(v-for="player, idx of settings.players")
            template(v-if="player")
              span.name(:class="$pbemServer.userCurrentMatches(player.dbId) ? 'self' : ''") {{player.name}}
              template(v-if="$pbemServer.userCurrentMatches(player.dbId)")
                input(type="button" :value="isHost ? 'Dissolve game' : 'Leave'" @click="playerKick(idx)")
              template(v-else-if="isHost")
                input(type="button" value="Kick" @click="playerKick(idx)")
            template(v-if="!player")
              span Empty slot
              input(type="button" value="Move here (TODO)")
              div(v-if="isHost && isLocal")
                input(type="button" value="Add local player..." @click="playerLocalSelect(idx)")
                //- input(type="button" value="Add friend...")
          .overlay(v-if="playerLocalSelectIndex >= 0")
            .back(@click="playerLocalSelectIndex = -1")
            .front
              input(v-for="player of playerLocalSelectPlayers" v-if="!playerInGame({type: 'local', id: player.localId})" type="button"
                  @click="playerLocalAdd(player.localId, player.name)"
                  :value="player.name")

      pbem-staging-settings(:settings="settings")
      input(type="button" value="Start" :disabled="!isHost" @click="startGame")
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

        .name.self {
          font-weight: bold;
        }
      }
      .overlay {
        position: fixed;
        left: 0;
        top: 0;
        right: 0;
        bottom: 0;

        > .back {
          position: absolute;
          left: 0;
          top: 0;
          right: 0;
          bottom: 0;
          opacity: 0.7;
          background-color: #000;
        }

        > .front {
          position: relative;
          display: inline-block;
          border: solid 1px #000;
          background-color: #fff;

          margin: auto;
          margin-top: 3em;

          input {
            display: block;
            margin: 1em;
          }
        }
      }
    }
  }
</style>

<script lang="ts">
import Vue from 'vue';

import {ServerError, ServerLink} from 'pbem-engine/lib/comm';
import {DbLocalUserDefinition} from 'pbem-engine/lib/comm/db';
import {PbemDbId} from 'pbem-engine/lib/game';
import {Settings} from '@/game';

export default Vue.extend({
  data() {
    return {
      // When we retrieve the settings object, we also get host information.
      host: undefined as PbemDbId | undefined,
      // And creator information
      createdBy: undefined as PbemDbId | undefined,
      // Flag for game is local.
      isLocal: false,
      // Flag used to prevent rewriting settings when not desired.
      inCallback: false,
      // Data for choosing local players
      playerLocalSelectIndex: -1,
      playerLocalSelectPlayers: [] as Array<DbLocalUserDefinition>,
      settings: undefined as Settings | undefined,
      settingsWatch: undefined as any,
    };
  },
  computed: {
    isHost(): boolean {
      let isHost = this.settings !== undefined && this.$pbemServer.userCurrentMatches(this.host!);
      let isCreator = this.settings !== undefined && this.createdBy && this.$pbemServer.userCurrentMatches(this.createdBy);
      return isHost || isCreator;
    },
    playersLength: {
      get: function(this: any) { return this.settings && this.settings!.players.length; },
      set: function(val) { if (this.settings) { this.settings!.players.length = val; this.settings = Object.assign({}, this.settings); } },
    },
  },
  watch: {
    '$route.params.id'(val) {
      this.loadSettings();
    },
    settings: {
      handler(this: any, val) {
        if (this.inCallback || val === undefined) return;
        console.log("Should update server");
      },
      deep: true,
    },
  },
  async mounted() {
    await this.$pbemServer.readyEvent;
    this.playerLocalSelectPlayers = await this.$pbemServer.userList();
    this.loadSettings();
  },
  beforeDestroy() {
    if (this.settingsWatch !== undefined) this.settingsWatch.cancel();
  },
  methods: {
    ignoreNextSettingsChange() {
      this.inCallback = true;
      // Change listener happens after $nextTick, so unset inCallback in two
      // ticks.
      this.$nextTick(() => {
        this.$nextTick(() => { this.inCallback = false; });
      });
    },
    async loadSettings() {
      if (this.settingsWatch !== undefined) this.settingsWatch.cancel();
      this.settings = undefined;
      const id = this.$route.params.id;
      this.settingsWatch = await ServerLink.stagingLoad<Settings>(
        id,
        ({isLocal, isPastStaging, host, createdBy, settings}) => {
          if (isPastStaging) {
            this.$router.replace({name: 'game', params: {id}});
          }
          else {
            this.host = host;
            this.createdBy = createdBy;
            this.isLocal = isLocal;
            this.ignoreNextSettingsChange();
            this.settings = settings;
          }
        },
        error => {
          if (error instanceof ServerError.NoSuchGameError) {
            this.$router.replace({ name: 'menu' });
          }
          else if (error instanceof ServerError.NotLoggedInError) {
            this.$router.replace({ name: 'menu' });
          }
          else {
            throw error;
          }
        },
      );
      let settings: Settings | undefined, isPastStaging: boolean | undefined,
          host: PbemDbId | undefined;
    },
    playerInGame(id: PbemDbId): boolean {
      for (const p of this.settings!.players) {
        if (!p) continue;
        if (this.$pbemServer.dbIdMatches(id, p.dbId)) {
          return true;
        }
      }
      return false;
    },
    async playerKick(idx: number) {
      const newSettings = await ServerLink.stagingPlayerKick(
          this.$route.params.id, idx);
      if (newSettings === undefined) {
        // Game dissolved
        this.$router.replace({name: 'menu'});
      }
      else {
        this.ignoreNextSettingsChange();
        this.settings = newSettings;
      }
    },
    async playerLocalAdd(localId: string, name: string) {
      if (this.playerInGame({type: 'local', id: localId})) {
        return;
      }
      const newSettings = await ServerLink.stagingPlayerAdd(
          this.$route.params.id, this.playerLocalSelectIndex,
          {type: 'local', id: localId}, name);
      this.ignoreNextSettingsChange();
      this.settings = newSettings as Settings;
      this.playerLocalSelectIndex = -1;
    },
    async playerLocalSelect(idx: number) {
      this.playerLocalSelectIndex = idx;
    },
    async startGame() {
      const settings = this.settings;
      if (settings === undefined || !this.isHost) return;
      await ServerLink.stagingStartGame(this.$route.params.id, settings);
      // Router triggered by settings load watcher, which will pick up that
      // the game is no longer in the 'staging' phase and move to the 'game'
      // view.
      //this.$router.replace({name: 'game', params: {id: this.$route.params.id}});
    },
  },
});
</script>

