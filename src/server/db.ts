/** Database records required for gameplay, or user management.
 *
 * NOTE: Game synchronization is based on _id of game document, or
 * "game === _id" within user/game databases.  Any "game" field is therefore
 * subject to special replication rules.  Type fields starting with "game-data"
 * will be replicated from the host to the client, and fields with
 * "game-response" will be replicated from the client to the host.  Certain
 * "game-response" documents, when replicated successfully, additionally
 * trigger some client-side behavior.
 *
 * DbGameDoc's settings may be used to validate the existence of
 * DbUserGameMembershipDoc.  Only forced via system though.
 * */

import {_PbemSettings} from '../game';

/** Document in game dtaabase. */
export type DbGame = DbGameDoc | DbGameStateDoc | DbUserActionDoc | DbUserActionRequestDoc | DbUserGameInvitationDoc | DbUserGameMembershipDoc;

/** Document in user database. */
export type DbUser = DbUserIdsDoc | DbGame;

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
  _deleted?: boolean;
  type: 'user-ids';
  // The remote ID, if one exists.  If this is filled, it means that our
  // current user account is tied to an online account, and should not be
  // overwritten.
  remoteId?: string;
  // Any local IDs used by this account.  Should be modified directly on remote
  // database to reduce probability of conflicts.
  localIds: string[];
  // The active local ID.  This host is responsible for running all games
  // hosted by this user, and may change.
  localIdActive: string;
};

/** DbGameDoc is the record which keeps track of information needed to run /
 * participate in a game.
 * */
export interface DbGameDoc {
  _id?: string;
  _deleted?: boolean;
  game: string;  // Matches _id
  type: 'game-data';
  // The host entity responsible for running this game.
  host: DbUserId;
  // The current phase of this game; always starts 'staging', 'game' means
  // in progress, and 'end' means that the game is immutable (finished).
  // 'ending' is a transient state meaning that all clients should be
  phase: 'staging' | 'game' | 'ending' | 'end';
  // During 'staging', settings may be modified.  After that point, it is a
  // fixed object.
  settings: _PbemSettings;
}

/** A snapshot of the game state, right before the given round index.
 * */
export interface DbGameStateDoc {
  _deleted?: boolean;
  _id?: string;
  type: 'game-data-state';
  game: string;
  round: number;
  state: any;
}

/** Prior to membership, remote users who are invited need to be notified.
 * Creating this document on any game or user's DB will trigger an invitation
 * of the specified party.
 *
 * Slot in game should be held while pending.  On accept, this document will be
 * retained as a permissions stub, provided a proper DbUserGameMembershipDoc
 * has been created.  On declined, this document will be deleted following the
 * slot's freeing.
 * */
export interface DbUserGameInvitationDoc {
  _deleted?: boolean;
  _id?: string;
  // This document is not replicated directly, but instead triggers an
  // invitation via a DbUserGameMembershipDoc.
  type: 'game-invitation';
  // The game to which the user is invited
  game: string;
  // Replication target for DbUserGameMembershipDoc
  userId: DbUserId;
}

/** For any game, including those hosted by this user, this points to the game.
 *
 * This document also validates that replication between game server and client
 * is allowed.  This document's omission should invalidate game membership,
 * resulting in the user being "kicked" from the game.  The omission of a
 * DbUserGameInvitationDoc will also invalidate replication, resulting in the
 * deletion of this document without further action.
 *
 * So, if this document is created on the client WITHOUT a corresponding
 * DbUserGameInvitationDoc on the host, then it will have no effect.  Similarly,
 * with a DbUserGameInvitationDoc but without a DbUserGameMembershipDoc,
 * the user will only be invited again, but replication will not proceed.
 *
 * Only documents matching current user will be pulled down.
 *
 * Note that this document is replicated back to the server, as a locally
 * cached confirmation that the user did join the game.
 * */
export interface DbUserGameMembershipDoc {
  _deleted?: boolean;
  _id?: string;
  type: 'game-response-member';
  // Exact userId match in game settings - also game replication target.
  userId: DbUserId;
  // Full address for replication information
  gameAddr: DbGameAddress;
  // Game ID for filtering - should match gameAddr.
  game: string;
  // Host name, for displaying game in lobby.
  hostName: string;
  // Game description information, for rendering the name in a lobby, copied
  // from the game's settings.
  desc?: any;
  // Status - anything not specified counts as 'leaving'.
  status: 'invited' | 'joined' | 'leaving';
  // TODO: user-specific settings (color preference, etc).  Would only matter
  // during staging, and be pulled finally before 'staging' -> 'game'.
}

/** Queues an action to be played (by this user).
 *
 * Server-side pull replication validates that user only requests actions for
 * their own userId.
 * */
export interface DbUserActionRequestDoc {
  _deleted?: boolean;
  _id?: string;
  type: 'game-response-action';
  game: string;  // Refer to GameMembershipDoc for full address.
  action: any;
}

/** Indicates that an action has occurred (by any user).
 * */
export interface DbUserActionDoc {
  _deleted?: boolean;
  _id?: string;
  type: 'game-data-action';
  game: string;
  action: any;
}

