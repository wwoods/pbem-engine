
import PbemStagingSettings from './pbem-staging-settings.vue';
import PbemGameView from './pbem-game-view.vue';

export const pbemVueDefaultsPlugin = {
  install(Vue: any, options: {}) {
    Vue.component('pbem-staging-settings', PbemStagingSettings);
    Vue.component('pbem-game-view', PbemGameView);
  },
};

