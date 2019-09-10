import Vue from 'vue';
import router from './router';
import './registerServiceWorker';

// Import PBEM components
import App from './App.vue';
import {pbemPlugin} from './plugins/pbem';
import {pbemVueDefaultsPlugin} from './components/defaults';

// Import user components
import {pbemVuePlugin} from '@/ui';

window.addEventListener('beforeinstallprompt', function(e: any) {
  // As per https://love2dev.com/blog/beforeinstallprompt/, could
  // show a custom prompt.
  // alert('hi');
});

Vue.config.productionTip = false;

//Register our plugin
Vue.use(pbemPlugin);

// Register our components
Vue.component('pbem-app', App);
Vue.use(pbemVueDefaultsPlugin);

// Register user components, potentially overwriting ours
Vue.use(pbemVuePlugin);

new Vue({
  router,
  render: (h) => h(Vue.component('pbem-app')),
}).$mount('#app');
