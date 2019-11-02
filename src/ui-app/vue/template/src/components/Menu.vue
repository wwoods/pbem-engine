<template lang="pug">
  .pbem-menu
    .game-name {{pbemTitle}}
    .block
      .title Users on Device
      .pbem-login
        div
          span New user name:
          input(type="text" autocomplete="off" autocorrect="off" spellcheck="false" 
              v-model="username")
          input(type="button" @click="userCreate(username)" value="Create")
      .pbem-login
        .select-list
          .select(v-for="user of users" @click="userLogin(user.localId)" 
              :userId="user.localId"
              :style="{'font-weight': $pbemServer.userLocalId === user.localId ? 'bold' : ''}"
              ) {{user.name}}

    div(v-if="$pbemServer.userLocalId")
      .block.blue
        .title Online Games
        .block.thin
          .title User Account
          div(v-if="$pbemServer.userCurrent.remoteName === undefined")
            div(style="font-weight: bold") New user registration
            div(v-if="onlineRegisterErrors.length > 0")
              div(style="color: #f00") {{onlineRegisterErrors}}
            table(style="width: 100%")
              tr
                td(style="text-align: right") Username
                td
                  input(type="text" autocomplete="off" autocorrect="off" spellcheck="false"
                    v-model="onlineUsername" style="width: 90%;")
              tr
                td(style="text-align: right") E-mail
                td
                  input(type="email" v-model="onlineEmail" style="width: 90%;")
              tr
                td(style="text-align: right") Password
                td
                  input(type="password" v-model="onlinePassword" style="width: 90%;")
            div
              input(type="button" value="Register" @click="onlineRegister")
          div(v-else)
            div(style="font-weight: bold") {{$pbemServer.userCurrent.remoteName}}
            div(v-if="onlineRegisterErrors.length > 0")
              div(style="color: #f00") {{onlineRegisterErrors}}
            div(v-if="userRemoteToken === undefined")
              div Log in again
              div
                span Password
                input(type="password" v-model="onlinePassword")
              div
                input(type="button" value="Log In" @click="onlineLogin")
        .block.thin(v-if="$pbemServer.userCurrent.remoteToken !== undefined")
          .title Active games
          .select-list
            .select(
                v-for="game of gamesRemote" 
                :gameId="game.game"
                @click="gameLoad(game.game)"
                )
                span {{gameName(game)}}
                span(v-if="game.gamePhase === 'staging'") &nbsp;(Staging)
          .title Available games
          .select-list
            .select(
                v-for="game of gamesRemoteAvailable"
                v-if="!onlineGameIsAlreadyJoined(game)"
                :gameId="game.game"
                @click="onlineGameJoin(game)"
                )
              span {{gameName(game)}}
          div(style="margin-bottom: 0.25em")
            input(type="button" @click="createSystem()" value="New online game")

      .block.blue
        .title Offline Games
        .block.thin
          .title Active games
          .select-list
            .select(
                v-for="game of gamesLocal" 
                :gameId="game.game"
                @click="gameLoad(game.game)"
                )
                span {{gameName(game)}}
                span(v-if="game.gamePhase === 'staging'") &nbsp;(Staging)
          div(style="margin-bottom: 0.25em")
            input(type="button" @click="createLocal()" value="New local game")
        .block.thin
          .title Finished games
          .select-list
            .select(
              v-for="game of gamesEnded"
              :gameId="game.game"
              @click="gameLoad(game.game)"
            )
              span {{gameName(game)}}

</template>

<style lang="scss">
  .pbem-menu {
    margin-left: auto;
    margin-right: auto;
    max-width: 500px;
    padding-top: 1em;

    .game-name {
      font-size: 2em;
    }

    .block {
      border-top: solid 0.25em #000;
      margin-bottom: 1em;

      .title {
        background-color: #eee;
        margin-bottom: 1em;
      }

      &.blue > .title { background-color: #ddf; }
      &.thin {
        border-top-width: 0.15em;
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

    input[type=button] {
      border-radius: 1em;
      padding: 1em;
    }
  }
</style>

<script lang="ts">
import axios from 'axios';
import Vue from 'vue';
import PouchDb from 'pbem-engine/lib/server/pouch';

import {Settings} from '@/game';

import {DbLocalUserDefinition} from 'pbem-engine/lib/comm/db';
import {DbGameDoc, DbUserGameMembershipDoc} from 'pbem-engine/lib/server/db';

export default Vue.extend({
  data() {
    return {
      username: 'Guest',
      pbemTitle: document.title,
      gamesLocal: [] as Array<DbUserGameMembershipDoc>,
      gamesRemote: [] as Array<DbUserGameMembershipDoc>,
      gamesRemoteAvailable: [] as Array<DbGameDoc>,
      gamesEnded: [] as Array<DbUserGameMembershipDoc>,
      users: [] as Array<DbLocalUserDefinition>,
      userRemoteToken: '' as string | undefined,
      onlineCheckCallback: null as any,
      onlineUsername: '',
      onlineEmail: '',
      onlinePassword: '',
      onlineRegisterErrors: '',
    };
  },
  async mounted() {
    await this.$pbemServer.readyEvent;
    await this.userLogin(this.$pbemServer.userLocalId);
  },
  beforeDestroy() {
    if (this.onlineCheckCallback !== null) {
      clearInterval(this.onlineCheckCallback);
      this.onlineCheckCallback = null;
    }
  },
  methods: {
    async createLocal() {
      await this.$pbemServer.createLocal(async (s: Settings) => {
        // TODO host = {type: 'local', id: user.localId}.
        // Can write settings here as desired needed, for e.g. a game campaign.
      });
    },
    async createSystem() {
      await this.$pbemServer.createSystem();
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
      const id = await this.$pbemServer.userCreate(username);
      await this.userLogin(id);
    },
    async userLogin(userLocalId: string | undefined) {
      if (userLocalId === undefined) {
        await this.userRefresh();
        return;
      }

      // Called after remote DB updated, so nothing about that needed.
      await this.$pbemServer.userLogin(userLocalId);
      // Trigger a local rebuild
      this.onlineUsername = this.$pbemServer.userCurrent!.name;

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
      if (this.onlineCheckCallback !== null) {
        clearInterval(this.onlineCheckCallback);
        this.onlineCheckCallback = null;
      }
      
      // Force a redraw.
      this.userRemoteToken = this.$pbemServer.userCurrent!.remoteToken;

      const u: Readonly<DbLocalUserDefinition> | undefined = this.$pbemServer.userCurrent;
      if (u === undefined) {
        // Not logged in, never was, ignore this.
        return;
      }

      // If they haven't registered, default to their local user name to avoid
      // confusion.
      this.onlineUsername = u.name;

      if (u.remoteToken === undefined) {
        // Not currently logged in; ignore.
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
          if (await this.onlineCheckAccountExists()) {
            await this.$pbemServer.userCurrentSetLogin(undefined, undefined);
            await this.userLogin(this.$pbemServer.userLocalId);
          }
        }
      }

      if (u.remoteToken === undefined) {
        return;
      }

      this.onlineCheckCallback = setInterval(() => {
        this.onlineGameList(true).catch(console.log);
      }, 5000);
      await this.onlineGameList();
    },
    async onlineCheckAccountExists(): Promise<boolean> {
      const u = this.$pbemServer.userCurrent!;
      try {
        const r = await axios.get('/auth/validate-username/' + u.remoteName);
        if (r.data.ok) {
          // This user does not exist.  Remove remote association...
          await this.$pbemServer.userCurrentSetRemote(undefined);
          this.onlineSetErrors('Previous user account no longer exists.');
          return false;
        }
      }
      catch (e) {
      }
      return true;
    },
    async onlineGameList(noClear?: boolean) {
      if (!noClear) {
        this.gamesRemoteAvailable = [];
      }

      const u = this.$pbemServer.userCurrent!;
      const games = await axios.post('/pbem/list', {}, {
        headers: {
          Authorization: 'Bearer ' + u.remoteToken,
        },
      });

      let docs = games.data as DbGameDoc[];
      this.gamesRemoteAvailable = docs;
    },
    onlineGameIsAlreadyJoined(game: DbGameDoc) {
      return this.gamesRemote.map(x => x.game).indexOf(game.game) !== -1;
    },
    async onlineGameJoin(game: DbGameDoc) {
      // We just make a membership document, and the server takes care of the 
      // rest.
      let hasSpace = false;
      for (const u of game.settings.players) {
        if (!u) {
          hasSpace = true;
          break;
        }
      }
      if (!hasSpace) {
        this.onlineSetErrors('Game is full, cannot join');
        return;
      }

      await this.$pbemServer.gameJoin(game);
      this.$router.push({name: 'staging', params: {id: game._id!}});
    },
    async onlineLogin() {
      this.onlineRegisterErrors = '';
      try {
        const u = this.$pbemServer.userCurrent!;
        const login = await axios.post('/auth/login', {
          username: u.remoteName,
          password: this.onlinePassword,
        });

        // Save token, password, and user DB; update local registration.
        const token = login.data.token;
        const password = login.data.password;
        const db = login.data.userDBs.pbem;
        await this.$pbemServer.userCurrentSetLogin(`${token}:${password}`, db);

        this.userLogin(this.$pbemServer.userLocalId);
      }
      catch (e) {
        if (await this.onlineCheckAccountExists()) {
          this.onlineSetErrorsFromResponse(e);
        }
      }
    },
    async onlineRegister() {
      this.onlineRegisterErrors = '';
      try {
        const username = this.onlineUsername.toLowerCase();
        const response = await axios.post('/auth/register', {
          username: username,
          email: this.onlineEmail,
          password: this.onlinePassword,
          confirmPassword: this.onlinePassword,
        });

        // On success, save information, and log in.
        await this.$pbemServer.userCurrentSetRemote(username);

        await this.onlineLogin();
      }
      catch (e) {
        this.onlineSetErrorsFromResponse(e);
      }
    },
    onlineSetErrors(e: string) {
      this.onlineRegisterErrors = e;
    },
    onlineSetErrorsFromResponse(e: any) {
      if (!e.response) {
        this.onlineRegisterErrors = 'offline or server down';
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

