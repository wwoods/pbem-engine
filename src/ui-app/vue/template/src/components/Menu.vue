<template lang="pug">
  div
    .pbem-login
      div
        span User (should work across tabs):
        input(type="text" v-model="username")
      div
        input(type="button" @click="userCreate(username)" value="Create")
    .pbem-login
      ul
        li(v-for="user of users" @click="userLogin(user.localId)" 
            :userId="user.localId"
            :style="{'font-weight': $pbemServer.userLocalId === user.localId ? 'bold' : ''}"
            ) {{user.name}}
    .pbem-games
      ul
        li(
            v-for="game of games" 
            :gameId="game.game"
            @click="gameLoad(game.game)"
            )
            span {{gameName(game)}}
            span(v-if="game.gameEnded") &nbsp;(Ended)
      span TODO: active games.
    .pbem-menu(v-if="$pbemServer.userLocalId")
      input(type="button" @click="createLocal()" value="Create local")
</template>

<style lang="scss">
  .pbem-login {
    display: block;
    max-width: 500px;
    margin-left: auto;
    margin-right: auto;
    border: solid 1px #000;
  }
</style>

<script lang="ts">
import Vue from 'vue';
import PouchDb from 'pbem-engine/lib/server/pouch';

import {Settings} from '@/game';

import {DbLocalUserDefinition} from 'pbem-engine/lib/comm/db';
import {DbUserGameMembershipDoc} from 'pbem-engine/lib/server/db';

export default Vue.extend({
  data() {
    return {
      username: 'Guest1',
      games: [] as Array<DbUserGameMembershipDoc>,
      users: [] as Array<DbLocalUserDefinition>,
    };
  },
  async mounted() {
    await this.$pbemServer.readyEvent;
    await this.gameRefresh();
    await this.userRefresh();
  },
  methods: {
    async createLocal() {
      console.log(this);
      await this.$pbemServer.createLocal(async (s: Settings) => {
        // TODO host = {type: 'local', id: user.localId}.
        // Can write settings here as desired needed, for e.g. a game campaign.
      });
    },
    gameLoad(id: string) {
      this.$router.push({name: 'game', params: {id}});
    },
    gameName(game: DbUserGameMembershipDoc) {
      const names = [
        'Alpha',
        'Whiskey',
        'Tango',
        'Delta',
        'Ela',
        'Bella',
        'Niner',
        'Dubious',
        'Hellacious',
        'Oak',
        'Mountain',
        'Berry',
        'Resort',
        'Battlefield',
        'Yogurt',
        'Tapioca',
      ];
      const name = [];
      name.push(game.hostName);
      for (let i = 0, m = 3; i < m; i++) {
        // Game IDs prefixed with 'game'
        name.push(names[parseInt(game.game[i + 4], 16)]);
      }
      return name.join(' ');
    },
    async gameRefresh() {
      try {
        this.games = await this.$pbemServer.gameListMembership();
      }
      catch (e) {
        this.games = [];
      }
    },
    async userCreate(username: string) {
      await this.$pbemServer.userCreate(username);
      await this.userRefresh();
    },
    async userLogin(userLocalId: string) {
      // TODO second argument would be remote DB.
      await this.$pbemServer.userLogin(userLocalId);
      await this.userRefresh();
      await this.gameRefresh();
    },
    async userRefresh() {
      this.users = await this.$pbemServer.userList();
    },
  },
});
</script>

