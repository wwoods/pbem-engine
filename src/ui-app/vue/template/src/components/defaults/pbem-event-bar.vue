<template lang="pug">
  .pbem-event-bar(:class="classes")
    .info
      .ev-info(v-for="ev of events" :key="ev.eventId" v-show="ev.eventId === active" @click="active = undefined")
        slot(:ev="ev")
          span Event {{ev.eventId}}: {{ev.type}}: {{ev.game}}
    transition-group(name="icon-list" tag="div" class="icons")
      .ev-icon(v-for="ev of events" :key="ev.eventId" @click="active = ev.eventId"
          :class="{selected: active === ev.eventId, seen: eventsViewed.has(ev.eventId)}")
        slot(name="icon" :ev="ev")
          span {{ev.type}}
</template>

<style scoped lang="scss">
.pbem-event-bar {
  &.right {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;

    display: flex;
    flex-direction: row;
  }
  &.bottom {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;

    display: flex;
    flex-direction: column;
  }

  .info {
    display: inline-block;
  }

  .icons {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;

    .ev-icon {
      display: flex;
      align-items: center;
      justify-items: center;
      justify-content: space-around;
      margin: 0.1rem;
      padding: 0.25rem;
      height: 2rem;
      width: 2rem;
      border-radius: 1rem;

      &.selected {
        background-color: #fa9a85 !important;
      }
      &.seen {
        background-color: #eee;
      }
      &:not(.seen) {
        background-color: #f5d6c6;
        animation: icon-pulse 1.5s ease infinite;
      }

      transition: all 300ms;
      &.icon-list-enter-active, &.icon-list-leave-active {
        animation: none;
      }
      &.icon-list-enter, &.icon-list-leave-to {
        opacity: 0;
        transform: translateY(30px);
      }
      &.icon-list-enter-to {
        opacity: 1;
        transform: translateY(0px);
      }
      &.icon-list-enter-to:not(.seen) {
        transform: scale(1.15);
      }

      @keyframes icon-pulse {
        0% { transform: scale(1.15); }
        50% { transform: scale(0.85); }
        100% { transform: scale(1.15); }
      }
    }
  }
  &.right .icons {
    padding-right: 0.25em;
  }
  &.bottom .icons {
    padding-bottom: 0.25em;
  }
}
</style>

<script lang="ts">
import Vue from 'vue';

import {_PbemEvent} from 'pbem-engine/lib/game';

export default Vue.extend({
  data() {
    return {
      active: undefined as undefined | string,
      classes: [] as string[],
      eventsKnown: new Set<string>(),
      eventsViewed: new Set<string>(),
    };
  },
  computed: {
    events() {
      return this.$pbem.uiEvents.concat(
          this.$pbem.state.events[this.$pbem.playerId]);
    },
  },
  watch: {
    active(newVal: string | undefined) {
      if (newVal) {
        this.eventsViewed.add(newVal);
      }
    },
    events(newVal: _PbemEvent[]) {
      // Note: called twice when an event is re-freshed, first for the removal
      // and then for the add.  If that behavior is ever not desired, probably
      // best to handle it here with a $nextTick, rather than re-factoring the
      // way events are replaced.
      const eventsNew = new Set<string>(newVal.map(x => x.eventId));
      if (this.active !== undefined && !eventsNew.has(this.active)) {
        this.active = undefined;
      }
      if (this.active === undefined) {
        for (const e of eventsNew.values()) {
          if (!this.eventsKnown.has(e)) {
            this.active = e;
            break;
          }
        }
      }
      for (const e of this.eventsViewed.values()) {
        if (!eventsNew.has(e)) this.eventsViewed.delete(e);
      }
      this.eventsKnown = eventsNew;
    },
  },
  mounted() {
    this.onResize();
    window.addEventListener('resize', this.onResize);
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.onResize);
  },
  methods: {
    onResize() {
      if (window.innerHeight < window.innerWidth) {
        this.classes = ['right'];
      }
      else {
        this.classes = ['bottom'];
      }
    },
  },
});
</script>
