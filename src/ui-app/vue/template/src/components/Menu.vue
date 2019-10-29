<template lang="pug">
  .pbem-menu
    .block
      .title Users on Device
      .pbem-login
        div
          span New user name:
          input(type="text" v-model="username")
          input(type="button" @click="userCreate(username)" value="Create")
      .pbem-login
        .select-list
          .select(v-for="user of users" @click="userLogin(user.localId)" 
              :userId="user.localId"
              :style="{'font-weight': $pbemServer.userLocalId === user.localId ? 'bold' : ''}"
              ) {{user.name}}
    .block
      .title Offline Games
      .pbem-games
        span Active games
        .select-list
          .select(
              v-for="game of gamesLocal" 
              :gameId="game.game"
              @click="gameLoad(game.game)"
              )
              span {{gameName(game)}}
              span(v-if="game.gamePhase === 'staging'") &nbsp;(Staging)
        span Finished games
        .select-list
          .select(
            v-for="game of gamesEnded"
            :gameId="game.game"
            @click="gameLoad(game.game)"
          )
            span {{gameName(game)}}
      .pbem-menu(v-if="$pbemServer.userLocalId")
        input(type="button" @click="createLocal()" value="Create local game")

    .block
      .title Online Games
      .block2
        .title User Account
        div(v-if="$pbemServer.userRemoteName === undefined")
          div(style="font-weight: bold") New user registration
          div(v-if="onlineRegisterErrors.length > 0")
            div(style="color: #f00") {{onlineRegisterErrors}}
          div
            span Username
            input(type="text" v-model="onlineUsername")
          div
            span E-mail
            input(type="text" v-model="onlineEmail")
          div
            span Password
            input(type="password" v-model="onlinePassword")
          div
            input(type="button" value="Register" @click="onlineRegister")
        div(v-else)
          div(style="font-weight: bold") {{$pbemServer.userRemoteName}}
          div(v-if="onlineRegisterErrors.length > 0")
            div(style="color: #f00") {{onlineRegisterErrors}}
          div(v-if="userRemoteToken === undefined")
            div Log in again
            div
              span Password
              input(type="password" v-model="onlinePassword")
            div
              input(type="button" value="Log In" @click="onlineLogin")
      .block2
        .title Active games
        .select-list
          .select(
              v-for="game of gamesRemote" 
              :gameId="game.game"
              @click="gameLoad(game.game)"
              )
              span {{gameName(game)}}
              span(v-if="game.gamePhase === 'staging'") &nbsp;(Staging)

</template>

<style lang="scss">
  .pbem-menu {
    margin-left: auto;
    margin-right: auto;
    max-width: 500px;
    padding-top: 1em;

    .block {
      border-top: solid 0.25em #000;
      margin-bottom: 1em;

      .title {
        background-color: #eee;
        margin-bottom: 1em;
      }
    }

    .block2 {
      border-top: solid 0.15em #888;
      margin-bottom: 1em;

      .title {
        background-color: #ddf;
        margin-bottom: 1em;
      }
    }

    .select-list {
      margin-top: 0.25em;
      .select {
        background-color: #ddd;
        border: solid 0.1em #444;
        border-radius: 1em;
        margin-bottom: 0.25em;
        padding: 0.5em;
      }
    }
  }
</style>

<script lang="ts">
import axios from 'axios';
import Vue from 'vue';
import PouchDb from 'pbem-engine/lib/server/pouch';

import {Settings} from '@/game';

import {DbLocalUserDefinition} from 'pbem-engine/lib/comm/db';
import {DbUserGameMembershipDoc} from 'pbem-engine/lib/server/db';

export default Vue.extend({
  data() {
    return {
      username: 'Guest1',
      gamesLocal: [] as Array<DbUserGameMembershipDoc>,
      gamesRemote: [] as Array<DbUserGameMembershipDoc>,
      gamesEnded: [] as Array<DbUserGameMembershipDoc>,
      users: [] as Array<DbLocalUserDefinition>,
      userRemoteToken: '' as string | undefined,
      onlineUsername: 'user',
      onlineEmail: '',
      onlinePassword: '',
      onlineRegisterErrors: '',
    };
  },
  async mounted() {
    await this.$pbemServer.readyEvent;
    await this.userLogin(this.$pbemServer.userLocalId);
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
      let games: DbUserGameMembershipDoc[] = [];
      try {
        games = await this.$pbemServer.gameListMembership();
      }
      catch (e) {
      }

      games.sort((a, b) => {
        if (a.gamePhaseChange === undefined) return -1;
        if (b.gamePhaseChange === undefined) return 1;
        return b.gamePhaseChange - a.gamePhaseChange;
      });
      this.gamesEnded = games.filter(x => x.gameEnded);
      this.gamesLocal = games.filter(x => !x.gameEnded && x.gameAddr.host.type === 'local');
      this.gamesRemote = games.filter(x => !x.gameEnded && x.gameAddr.host.type !== 'local');
    },
    async userCreate(username: string) {
      await this.$pbemServer.userCreate(username);
      await this.userRefresh();
    },
    async userLogin(userLocalId: string | undefined) {
      if (userLocalId === undefined) {
        await this.userRefresh();
        return;
      }

      // Called after remote DB updated, so nothing a bout that needed.
      await this.$pbemServer.userLogin(userLocalId);

      // Check online status.
      await this.onlineCheck();

      await this.userRefresh();
      await this.gameRefresh();
    },
    async userRefresh() {
      this.users = await this.$pbemServer.userList();
    },
    async onlineCheck() {
      this.onlineRegisterErrors = '';
      
      // Force a redraw.
      this.userRemoteToken = this.$pbemServer.userRemoteToken;

      const u = this.$pbemServer.userCurrent;
      if (u === undefined || u.remoteToken === undefined) {
        // Not logged in, never was, ignore this.
        return;
      }

      try {
        const userInfo = await axios.get('/auth/session', {
          headers: {
            Authorization: `Bearer ${u.remoteToken!}`,
          },
        });
      }
      catch (e) {
        this.onlineSetErrorsFromResponse(e);
        if (this.onlineRegisterErrors.toLowerCase().trim() === 'unauthorized') {
          await this.$pbemServer.userCurrentSetLogin(undefined, undefined);
          await this.userLogin(this.$pbemServer.userLocalId);
        }
      }
    },
    async onlineLogin() {
      this.onlineRegisterErrors = '';
      try {
        const login = await axios.post('/auth/login', {
          username: this.$pbemServer.userRemoteName,
          password: this.onlinePassword,
        });

        console.log(login);

        // Save token, password, and user DB; update local registration.
        const token = login.data.token;
        const password = login.data.password;
        const db = login.data.userDBs.pbem;
        await this.$pbemServer.userCurrentSetLogin(`${token}:${password}`, db);

        this.userLogin(this.$pbemServer.userLocalId);
      }
      catch (e) {
        this.onlineSetErrorsFromResponse(e);
      }
    },
    async onlineRegister() {
      this.onlineRegisterErrors = '';
      try {
        const response = await axios.post('/auth/register', {
          username: this.onlineUsername,
          email: this.onlineEmail,
          password: this.onlinePassword,
          confirmPassword: this.onlinePassword,
        });

        // On success, save information, and log in.
        await this.$pbemServer.userCurrentSetRemote(this.onlineUsername);

        await this.onlineLogin();
      }
      catch (e) {
        this.onlineSetErrorsFromResponse(e);
      }
    },
    onlineSetErrorsFromResponse(e: any) {
      if (!e.response) {
        this.onlineRegisterErrors = 'offline?';
        return;
      }
      
      const r = e.response.data;
      const msg = [];
      if (Object.keys(r).indexOf('validationErrors') !== -1) {
        msg.push(r.error);
        for (const v of Object.keys(r.validationErrors)) {
          msg.push(...r.validationErrors[v]);
        }
      }
      else if (r.message !== undefined) {
        msg.push(r.message);
      }
      else {
        msg.push(r.toString());
      }
      this.onlineRegisterErrors = msg.join(', ');
    },
  },
});
</script>

