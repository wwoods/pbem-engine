import Vue from 'vue';
import {PlayerView, ServerLink} from 'pbem-engine/lib/comm';

import {PbemSettings, _pbemGameSetup} from 'pbem-engine/lib/game';
import {Settings, State, Action} from '@/game';

import router from '../router';

// $pbem refers to currently-active PlayerView.

export const pbemPlugin = {
  install(Vue: any, options: {}) {

    // Make user code available to core.
    _pbemGameSetup(Settings.Hooks, State.Hooks, Action.Types);

    // Have $pbem refer to an Actor which ties into a game state...
    // pass-and-play has a different Actor for each player which automatically
    // substitutes the correct state (for supporting future views of state)
    // and action abilities.  Additionally, for local games, there should be a
    // System actor.
    Object.defineProperty(Vue.prototype, '$pbem', {
      get() {
        return ServerLink.getActivePlayerView(this.$nextTick);
      },
    });


    Object.defineProperty(Vue.prototype, '$pbemServer', {
      get() {
        console.log('getter');
        return _pbemServer;
      },
    });
  },
};


/** Helper functions for starting / loading games.  In plugin to leverage user
 * code for typing.
 * */
export const _pbemServer = {
  async createLocal(init?: {(s: Settings): Promise<void>}): Promise<void> {
    const innerInit = async (s: Settings) => {
      Settings.Hooks.init(s);
      if (init !== undefined) await init(s);
    };
    const gameId = await ServerLink.stagingCreateLocal(innerInit);
    router.push({name: 'staging', params: {id: gameId}});
  }
};

