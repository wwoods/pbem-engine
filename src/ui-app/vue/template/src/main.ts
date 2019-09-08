import Vue from 'vue';
import router from './router';
import './registerServiceWorker';

// Import PBEM components
import App from './App.vue';
import PbemStagingSettings from './components/defaults/pbem-staging-settings.vue';
import PbemGameView from './components/defaults/pbem-game-view.vue';

// Import user components
import {pbemVuePlugin} from '@/ui';

Vue.config.productionTip = false;

// Register our components second, if not existing
Vue.component('pbem-app', App);
Vue.component('pbem-staging-settings', PbemStagingSettings);
Vue.component('pbem-game-view', PbemGameView);

// Register user components, potentially overwriting ours
Vue.use(pbemVuePlugin);

new Vue({
  router,
  render: (h) => h(Vue.component('pbem-app')),
}).$mount('#app');
