import Vue from 'vue';
import router from './router';
import './registerServiceWorker';

// Import PBEM components
import App from './App.vue';
import {pbemVueDefaultsPlugin} from './components/defaults';

// Import user components
import {pbemVuePlugin} from '@/ui';

Vue.config.productionTip = false;

// Register our components second, if not existing
Vue.component('pbem-app', App);
Vue.use(pbemVueDefaultsPlugin);

// Register user components, potentially overwriting ours
Vue.use(pbemVuePlugin);

new Vue({
  router,
  render: (h) => h(Vue.component('pbem-app')),
}).$mount('#app');
