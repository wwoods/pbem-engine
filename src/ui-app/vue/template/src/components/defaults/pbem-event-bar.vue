<template lang="pug">
  .pbem-event-bar(:class="classes")
    transition-group(name="icon-list" tag="div" class="icons")
      .ev-icon(v-for="ev of events" :key="ev.eventId" @click="active === ev.eventId ? (active = undefined) : (active = ev.eventId)"
          :class="{seen: eventsViewed.has(ev.eventId), showContent: eventsAnim[ev.eventId] && eventsAnim[ev.eventId].showContent}"
          :style="eventsAnim[ev.eventId] && eventsAnim[ev.eventId].style")
        .ev-icon-icon
          slot(name="icon" :ev="ev")
            span {{ev.type}}
        .ev-icon-content
          slot(:ev="ev")
            span Event {{ev.eventId}}: {{ev.type}}: {{ev.game}}
</template>

<style scoped lang="scss">
$selected_color: #fa9a85;
$unselected_color: #f5d6c6;
$inactive_color: #eee;
.pbem-event-bar {
  // pointer-events: none means that non-icon areas of the UI are not blocked
  // by an invisible DOM element.  Must be restored with pointer-events: auto
  // on children.
  pointer-events: none;

  &.right {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;

    display: flex;
    flex-direction: column;
    justify-content: space-around;

    .icons {
      // TODO max-height: 100%;
      // TODO overflow-y: scroll;
    }
  }
  &.bottom {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;

    display: flex;
    flex-direction: row;
    justify-content: space-around;

    .icons {
    }
  }

  .icons {
    .ev-icon.showContent {
      position: fixed;
      left: -1.25rem;
      right: -0.5rem;
      top: 20vh;
      z-index: 1000;
    }
  }

  .icons {
    display: flex;
    justify-items: center;
    justify-content: center;
    align-items: flex-end;

    .ev-icon {
      flex-shrink: 0;
      pointer-events: auto;

      display: flex;
      align-items: end;
      justify-items: center;
      justify-content: space-around;
      margin: 0.1rem;
      padding: 0.25rem;
      border-radius: 1rem;
      transition: all 200ms;
      transition-property: transform, background-color;
      &.selected {
        background-color: $selected_color !important;
      }
      &.seen {
        background-color: $inactive_color;
      }
      &:not(.seen) {
        background-color: $unselected_color;
      }
      // Note: vue bug.  If animation is specified when DOM element mounted,
      // cannot un-set animation for transitions.
      &:not(.seen):not(.showContent):not(.icon-list-enter-active):not(.icon-list-leave-active) {
        animation: icon-pulse 1.5s ease infinite;
      }

      &.icon-list-enter, &.icon-list-leave-to {
        transform: translateY(30px) scaleY(0) scale(1);
      }
      &.icon-list-enter-to:not(.seen) {
        transform: translateY(0) scaleY(1) scale(1.15);
      }

      @keyframes icon-pulse {
        0% { transform: scale(1.15); }
        50% { transform: scale(0.85); }
        100% { transform: scale(1.15); }
      }

      .ev-icon-icon {
        flex-shrink: 0;

        display: flex;
        flex-direction: row;
        align-items: center;
        justify-items: center;
        justify-content: space-around;

        width: 2rem;
        height: 2rem;
      }

      .ev-icon-content {
        flex-grow: 1;
        flex-shrink: 1;

        display: none;
        padding: 0.25rem;
        margin: 0.1rem 0.1rem 0.1rem 0.25rem;
        background-color: #fff;
        border-radius: 1rem;
      }
      &.showContent .ev-icon-content {
        display: inline-block;
      }
    }
  }
  &.right .icons {
    padding-right: 0.25rem;
    flex-direction: column;
  }
  &.bottom .icons {
    padding-bottom: 0.25rem;
    flex-direction: row;
  }
}
</style>

<script lang="ts">
import {TimelineLite} from 'gsap/TweenMax';
import Vue from 'vue';

import {_PbemEvent} from 'pbem-engine/lib/game';

export default Vue.extend({
  data() {
    return {
      active: undefined as undefined | string,
      classes: [] as string[],
      eventsAnim: {} as {[key: string]: {style: {opacity: number},
          showContent: boolean}},
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
    '$pbem.playerId'(newVal: number) {
      this.eventsAnim = {};
      this.eventsKnown.clear();
      this.eventsViewed.clear();
      this.active = undefined;
      this._eventsCheck(this.events);
    },
    active(newVal: string | undefined, oldVal: string | undefined) {
      this._eventsCheck(this.events);
      const ts = 3; // timescale
      if (oldVal && this.eventsAnim[oldVal]) {
        this.eventsViewed.add(oldVal);

        const style = this.eventsAnim[oldVal].style;
        const tl = new TimelineLite();
        tl.to(style, 0.2, {opacity: 0});
        tl.delay(0.1);
        tl.set(this.eventsAnim[oldVal], {showContent: false});
        tl.delay(0.1);
        tl.to(style, 0.2, {opacity: 1});
        const tts = ts * (newVal ? 4 : 1);
        tl.timeScale(tts).play();
      }
      if (newVal) {
        //this.eventsViewed.add(newVal);

        const ea = this.eventsAnim[newVal];
        const style = ea.style;
        const tl = new TimelineLite();
        if (!ea.showContent) {
          tl.set(style, {opacity: 1});
          tl.to(style, 0.2, {opacity: 0});
          tl.delay(0.1);
          tl.set(this.eventsAnim[newVal], {showContent: true});
        }
        else {
          tl.set(style, {opacity: 0});
        }
        tl.delay(0.1);
        tl.to(style, 0.2, {opacity: 1});
        tl.timeScale(ts).play();
      }
    },
    events(newVal: _PbemEvent[]) {
      this._eventsCheck(newVal);
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
    _eventsCheck(newVal: _PbemEvent[]) {
      // Note: called twice when an event is re-freshed, first for the removal
      // and then for the add.  If that behavior is ever not desired, probably
      // best to handle it here with a $nextTick, rather than re-factoring the
      // way events are replaced.
      const eventsNew = new Set<string>(newVal.map(x => x.eventId));
      if (this.active !== undefined && !eventsNew.has(this.active)) {
        this.active = undefined;
      }
      for (const e of eventsNew.values()) {
        if (!this.eventsKnown.has(e)) {
          if (this.active === undefined) {
            this.active = e;
          }

          Vue.set(this.eventsAnim, e, {
            style: {opacity: 1},
            showContent: this.active === e,
          });
        }
      }
      for (const e of this.eventsViewed.values()) {
        if (!eventsNew.has(e)) {
          // Remove
          Vue.delete(this.eventsAnim, e);
          this.eventsViewed.delete(e);
        }
      }
      this.eventsKnown = eventsNew;
    },
  },
});
</script>
