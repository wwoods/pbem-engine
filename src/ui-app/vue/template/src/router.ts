import Vue from 'vue';
import Router from 'vue-router';

Vue.use(Router);

// TODO rather than hard-coded importing self's components, allow apps to
// override the default layouts by checking for existence of e.g.
// @/ui/pbem/Menu.

export default new Router({
  mode: 'history',
  base: process.env.BASE_URL,
  routes: [
    {
      path: '/',
      name: 'menu',
      component: () => import(/* webpackChunkName: "menu" */ './components/Menu.vue'),
    },
    {
      path: '/staging/:id',
      name: 'staging',
      // route level code-splitting
      // this generates a separate chunk (about.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import(/* webpackChunkName: "staging" */ './components/Staging.vue'),
    },
    {
      path: '/game/:id',
      name: 'game',
      component: () => import(/* webpackChunkName: "game" */ './components/Game.vue'),
    },
  ],
});
