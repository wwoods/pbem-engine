
import PbemEventBar from './pbem-event-bar.vue';
import PbemGameView from './pbem-game-view.vue';
import PbemIsometricViewDom from './pbem-isometric-view-dom.vue';
import PbemSplashscreenPassAndPlay from './pbem-splashscreen-pass-and-play.vue';
import PbemStagingSettings from './pbem-staging-settings.vue';

export const pbemVueDefaultsPlugin = {
  install(Vue: any, options: {}) {
    Vue.component('pbem-event-bar', PbemEventBar);
    Vue.component('pbem-game-view', PbemGameView);
    Vue.component('pbem-splashscreen-pass-and-play', PbemSplashscreenPassAndPlay);
    Vue.component('pbem-staging-settings', PbemStagingSettings);

    // Doesn't take up too much space, ideally...
    Vue.component('pbem-isometric-view-dom', PbemIsometricViewDom);
  },
};

