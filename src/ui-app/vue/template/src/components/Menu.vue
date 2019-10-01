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
        li(v-for="user of users" @click="userLogin(user.idLocal)" :style="{'font-weight': $pbemServer.userCurrentId === user.idLocal ? 'bold' : ''}") {{user.name}}
    .pbem-menu
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
import {DbLocalUsers} from 'pbem-engine/lib/comm/db';

export default Vue.extend({
  data() {
    return {
      username: 'Guest1',
      users: [] as DbLocalUsers,
    };
  },
  async mounted() {
    await this.userRefresh();
  },
  methods: {
    async createLocal() {
      console.log(this);
      await this.$pbemServer.createLocal(async (s: Settings) => {
        //TODO host = {type: 'local', id: user.idLocal}.
        //Local can overwrite ID.
        s.gameId = "TODO";
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

