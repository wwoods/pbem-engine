/** Database records required for gameplay, or user management.
 *
 * NOTE: Game synchronization is based on _id of game document, or
 * "game === _id" within user/game databases.  Any "game" field is therefore
 * subject to special replication rules.
 *
 * DbGameDoc's settings may be used to validate the existence of
 * DbUserGameMembershipDoc.  Only forced via system though.
 * */

import {_PbemSettings} from '../game';

/** Document in game dtaabase. */
export type DbGame = DbGameDoc | DbGameStateDoc | DbUserActionDoc | DbUserActionRequestDoc;

/** Document in user database. */
export type DbUser = DbUserIdsDoc | DbUserGameInvitationDoc | DbUserGameMembershipDoc | DbGame;

/** Points to a specific database which contains information related to games.
 * */
export type DbUserId = {
  type: 'local' | 'remote' | 'system';
  id: string;
};

/** Regardless of where a `DbGameAddress` occurs, it defines a unique way to
 * lookup a specific game relative to _the current user's DB_.
 * */
export type DbGameAddress = {
  // Means of locating the database containing this game's record.
  host: DbUserId;
  // The `_id` of the actual `DbGame` document.
  id: string;
};

export type DbUserIdsDoc = {
  _id: 'user-ids';
  type: 'user-ids';
  // The remote ID, if one exists.  If this is filled, it means that our
  // current user account is tied to an online account, and should not be
  // overwritten.
  remoteId?: string;
  // Any local IDs used by this account.  Should be modified directly on remote
  // database to reduce probability of conflicts.
  localIds: string[];
};

/** DbGameDoc is the record which keeps track of information needed to run /
 * participate in a game.
 * */
export interface DbGameDoc {
  type: 'game';
  // The host entity responsible for running this game.
  host: DbUserId;
  // The user entity which created this game - may be undefined for a
  // system-created matchup, or may different or the same as host.
  // Basically determines which users are allowed to tweak the "settings"
  // object.
  createdBy?: DbUserId;
  // The current phase of this game; always starts 'staging', 'game' means
  // in progress, and 'end' means that the game is immutable (finished).
  phase: 'staging' | 'game' | 'end';
  // During 'staging', settings may be modified.  After that point, it is a
  // fixed object.
  settings: _PbemSettings;
}

/** A snapshot of the game state, right before the given round index.
 * */
export interface DbGameStateDoc {
  type: 'game-state';
  game: string;
  round: number;
  state: any;
}

/** Prior to membership, remote users who are invited need to be notified.
 *
 * Slot in game will be held while pending.  On accept, this document will be
 * deleted, provided a proper DbUserGameMembershipDoc has been created.  On
 * declined, this document will be deleted following the slot's freeing.
 * */
export interface DbUserGameInvitationDoc {
  type: 'game-invitation';
  gameAddr: DbGameAddress;
  status: 'pending' | 'accepted' | 'declined'
}

/** For any game, including those hosted by this user, this points to the game.
 *
 * This document is not used directly - that is, user DBs only sync with user
 * DBs.  But,
 * */
export interface DbUserGameMembershipDoc {
  type: 'game-member';
  gameAddr: DbGameAddress;
  // TODO: user-specific settings (color preference, etc).  Would only matter
  // during staging, and be pulled finally before 'staging' -> 'game'.
}

/** Queues an action to be played (by this user).
 * */
export interface DbUserActionRequestDoc {
  type: 'game-action-request';
  game: string;  // Refer to GameMembershipDoc for full address.
  action: any;
}

/** Indicates that an action has occurred (by any user).
 * */
export interface DbUserActionDoc {
  type: 'game-action';
  game: string;
  action: any;
}

