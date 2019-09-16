
import PbemEventBar from './pbem-event-bar.vue';
import PbemGameView from './pbem-game-view.vue';
import PbemStagingSettings from './pbem-staging-settings.vue';

export const pbemVueDefaultsPlugin = {
  install(Vue: any, options: {}) {
    Vue.component('pbem-event-bar', PbemEventBar);
    Vue.component('pbem-game-view', PbemGameView);
    Vue.component('pbem-staging-settings', PbemStagingSettings);
  },
};

