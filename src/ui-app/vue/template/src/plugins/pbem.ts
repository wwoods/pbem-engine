import Vue from 'vue';
import {PlayerView, ServerLink} from 'pbem-engine/lib/comm';
import {DbLocalUserDefinition} from 'pbem-engine/lib/comm/db';
import {PbemDbId, PbemSettings, _pbemGameSetup} from 'pbem-engine/lib/game';
import {ServerError} from 'pbem-engine/lib/server/common';
import {DbUserId} from 'pbem-engine/lib/server/db';

import {Settings, State, Action} from '@/game';

import router from '../router';

// $pbem refers to currently-active PlayerView.

export const pbemPlugin = {
  install(Vue: any, options: {}) {

    // Make user code available to core.
    _pbemGameSetup(Settings.Hooks, State.Hooks, Action.Types);

    ServerLink.init();

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
  },
  /** See if the current user matches a PbemDbId from a game.
   * */
  userCurrentMatches(id: PbemDbId) {
    return ServerLink.userCurrentMatches(id as DbUserId);
  },
  /** See if two IDs match, given a list of local users.
   *
   * This function is to be used in 'staging' setup only, to prevent duplicate
   * registrations.
   * */
  dbIdMatches(id1: PbemDbId, id2: PbemDbId) {
    return ServerLink.dbIdMatches(id1 as DbUserId, id2 as DbUserId);
  },
  get readyEvent() {
    return ServerLink.readyEvent;
  },
  get userLocalId() {
    const u = ServerLink.userCurrent;
    return u && u.localId;
  },
  async userCreate(username: string) {
    return await ServerLink.userCreate(username);
  },
  async userList() {
    return await ServerLink.userList();
  },
  async userLogin(userId: string) {
    return await ServerLink.userLogin(userId);
  },
};

