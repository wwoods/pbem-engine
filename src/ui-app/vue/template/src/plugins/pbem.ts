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
    const u = ServerLink.userCurrent;
    if (u === undefined) return false;

    const i = id as DbUserId;
    // TODO make this work with all user local IDs; we may be on a different
    // device.
    if (i.type === 'local' && u.localId === i.id) return true;
    if (i.type === 'remote' && u.remoteId === i.id) return true;
    return false;
  },
  /** See if two IDs match, given a list of local users.
   *
   * This function is to be used in 'staging' setup only, to prevent duplicate
   * registrations.
   * */
  dbIdMatches(id1: PbemDbId, id2: PbemDbId, userList: Array<DbLocalUserDefinition>) {
    const i1 = id1 as DbUserId;
    const i2 = id2 as DbUserId;
    let iLocal: DbUserId, iOther: DbUserId;
    if (i1.type === 'system') {
      return i2.type === 'system' && i1.id === i2.id;
    }
    else if (i1.type === 'remote') {
      if (i2.type === 'remote') {
        return i1.id === i2.id;
      }
      else if (i2.type === 'system') return false;

      iLocal = i2;
      iOther = i1;
    }
    else {
      iLocal = i1;
      iOther = i2;
    }

    // iLocal is populated.  Identify it in the user list, and then try to
    // resolve iOther.
    if (iOther.type === 'system') return false;

    for (const u of userList) {
      for (const uid of u.localIdAll) {
        if (uid === iLocal.id) {
          // Presumably unique match
          if (iOther.type === 'remote') return u.remoteId === iOther.id;
          else if (iOther.type === 'local') return u.localIdAll.indexOf(
              iOther.id) !== -1;
          return false;
        }
      }
    }

    // Unable to make a determination; shouldn't happen ever.  Would mean that
    // e.g. a remote player is attempting to validate a player local to some
    // user other than themselves, which is madness.
    throw new ServerError.ServerError(`Could not resolved ${iLocal}`);
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

