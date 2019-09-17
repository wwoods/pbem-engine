<template lang="pug">
  .splashscreen(@click="dismiss()" :class="{dismissed}")
    div
      div.header {{$pbem.state.settings.players[$pbem.playerId].name}}
      div.info Tap to continue.
</template>

<style scoped lang="scss">
.splashscreen {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background-color: #000;
  color: #fff;

  display: flex;
  align-items: center;
  justify-items: center;
  justify-content: space-around;

  transition: all 200ms;
  &.dismissed {
    opacity: 0;
    pointer-events: none;
  }

  .header {
    font-size: 3em;
  }
  .info {
    color: #aaa;
  }
}
</style>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  data() {
    return {
      dismissed: false,
    };
  },
  watch: {
    '$pbem.playerId'(newId: number) {
      this.dismissed = false;
    },
  },
  methods: {
    dismiss() {
      this.dismissed = true;
    },
  },
});
</script>
