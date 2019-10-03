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
        li(v-for="user of users" @click="userLogin(user.localId)" :style="{'font-weight': $pbemServer.userLocalId === user.localId ? 'bold' : ''}") {{user.name}}
    .pbem-games
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

import {Settings} from '@/game';

import {ServerLink} from 'pbem-engine/lib/comm';
import {DbLocalUserDefinition} from 'pbem-engine/lib/comm/db';

export default Vue.extend({
  data() {
    return {
      username: 'Guest1',
      users: [] as Array<DbLocalUserDefinition>,
    };
  },
  async mounted() {
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
    async userCreate(username: string) {
      await this.$pbemServer.userCreate(username);
      await this.userRefresh();
    },
    async userLogin(userLocalId: string) {
      // TODO second argument would be remote DB.
      await this.$pbemServer.userLogin(userLocalId);
      await this.userRefresh();
    },
    async userRefresh() {
      this.users = await this.$pbemServer.userList();
    },
  },
});
</script>

