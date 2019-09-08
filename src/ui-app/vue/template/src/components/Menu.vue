<template lang="pug">
  .pbem-menu
    input(type="button" @click="createLocal" value="Create local")
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  methods: {
    createLocal() {
      this.$router.push({name: 'staging', params: {id: 'lTODO'}});
    },
  },
});
</script>

