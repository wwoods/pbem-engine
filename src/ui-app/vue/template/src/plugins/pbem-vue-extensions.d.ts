
import {State, Action} from '@/game';

import Vue from 'vue';
import {PlayerView} from 'pbem-engine/lib/comm';
import {_pbemServer} from './pbem';
declare module 'vue' {
  export default interface Vue {
    $pbem: PlayerView<State, Action>;
    $pbemServer: typeof _pbemServer;
  }
}
