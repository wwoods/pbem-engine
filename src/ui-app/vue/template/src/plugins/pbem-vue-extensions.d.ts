import Vue from 'vue';
import {_PbemState} from 'pbem-engine/lib/game';
import {PlayerView} from 'pbem-engine/lib/comm';
declare module 'vue' {
  export default interface Vue {
    $pbem: PlayerView<_PbemState>;
    $pbemServer: any;
  }
}
