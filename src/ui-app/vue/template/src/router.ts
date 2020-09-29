import Vue from 'vue';
import Router, {RouteConfig} from 'vue-router';

Vue.use(Router);

// TODO rather than hard-coded importing self's components, allow apps to
// override the default layouts by checking for existence of e.g.
// @/ui/pbem/Menu.

const routes: Array<RouteConfig> = [
    {
      // Redirect for PWA functionality, similar to https://stackoverflow.com/a/54847456
      path: '/index.html',
      redirect: '/',
    },
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
];

if (process.env.NODE_ENV !== 'production') {
  // Dev paths
  console.log("pbem-engine: Manually navigate to '#/dev' for developer tools");

  /** NOTE: all should have webpackChunkName: "dev" */
  routes.push(...[
    {
      path: '/dev/s/:scenario',
      name: 'dev-scenario',
      component: () => import(/* webpackChunkName: "dev" */ './components/dev/Scenario.vue'),
    },
    {
      path: '/dev',
      name: 'dev',
      component: () => import(/* webpackChunkName: "dev" */ './components/dev/Dev.vue'),
    },
  ]);
}

export default new Router({
  mode: 'hash',
  base: process.env.BASE_URL,
  routes: routes,
});
