
import PbemIsometricViewDom from './pbem-isometric-view-dom.vue';
import PbemIsometricViewPixi from './pbem-isometric-view-pixi.vue';

const VuePlugin = {
  install(Vue: any, options: any) {
    // Doesn't take up too much space, ideally...
    Vue.component('pbem-isometric-view-dom', PbemIsometricViewDom);
    Vue.component('pbem-isometric-view-pixi', PbemIsometricViewPixi);
  },
};

export default VuePlugin;
