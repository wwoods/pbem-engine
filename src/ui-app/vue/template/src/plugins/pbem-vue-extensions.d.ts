
import {State, Action} from '@/game';

import Vue from 'vue';
import {PlayerView} from 'pbem-engine/lib/comm';
declare module 'vue' {
  export default interface Vue {
    $pbem: PlayerView<State, Action>;
    $pbemServer: any;
  }
}
