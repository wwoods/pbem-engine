import Vue from 'vue';
import router from './router';
import './registerServiceWorker';
import Vue2TouchEvents from 'vue2-touch-events';

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

document.addEventListener('swUpdated', (event: any) => {
  // TODO for now, always update; see https://medium.com/@dougallrich/give-users-control-over-app-updates-in-vue-cli-3-pwas-20453aedc1f2
  // for UI tip.
  const registration = event.detail;
  if (!registration || !registration.waiting) return;
  registration.waiting.postMessage('skipWaiting');
}, {once: true});
if (navigator && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

// TODO https://medium.com/@dougallrich/give-users-control-over-app-updates-in-vue-cli-3-pwas-20453aedc1f2 for PWA updates
// TODO https://josephuspaye.github.io/Keen-UI/ may as well integrate a lightweight library into the template.

Vue.config.productionTip = false;

Vue.use(Vue2TouchEvents);

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
