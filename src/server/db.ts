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

import {_PbemSettings, PbemError} from '../game';
import { getDiffieHellman } from 'crypto';

/** Document in game database. 
 * 
 * Note that databases may get quite large, as 1 action = 1 document.  So,
 * important to scan only changes (DbUserActionRequestDoc) and states, 
 * traversing the action tree using an efficient index.
*/
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

export type GamePhase = 'staging' | 'game' | 'game-over';

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
  // The name of the host entity
  hostName: string;
  // The current phase of this game; always starts 'staging', 'game' means
  // in progress, and 'end' means that the game is immutable (finished).
  // 'ending' is a transient state meaning that all clients should be
  phase: GamePhase;
  // Signals that the game requires one final replication to clients, and then
  // it's over.  Appends '-ended' to the current phase when done.
  // NOTE: Game daemon still runs until 'ending' set to false.
  ending?: boolean;
  // Signals that the game is completely over.  Will be set before ending is
  // unset.
  ended?: boolean;
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
  // Action preceding this game state.
  actionPrev: number;
  state: any;
}
export namespace DbGameStateDoc {
  export function getId(gameId: string, actionPrevIndex: number) {
    const s = '00000000' + actionPrevIndex;
    if (s.length > 16) {
      throw new PbemError(`Bad action index: ${actionPrevIndex}`);
    }
    return `${gameId}-s${s.substr(-8)}`;
  }
  export function getIdLast(gameId: string) {
    return `${gameId}-s\ufff0`;
  }
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
  // These two fields copied in gameDaemonController.ts
  gamePhase?: GamePhase;
  gameEnded?: boolean;
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
  // Previously requested action index
  prev: number;
}

/** Indicates that an action has occurred (by any user).
 * 
 * Note that game-data-action has special _id field: the game name followed by
 * '-' followed by the 0-leading, 8-digit action index.
 * */
export interface DbUserActionDoc {
  _deleted?: boolean;
  _id?: string;
  type: 'game-data-action';
  game: string;
  // All actions in chain.
  actions: any[];
  // Action request ID, if any
  request?: string;
}
export namespace DbUserActionDoc {
  export function getId(gameId: string, actionIndex: number) {
    const s = '00000000' + actionIndex;
    if (s.length > 16) {
      throw new PbemError(`Bad action index: ${actionIndex}`);
    }
    return `${gameId}-a${s.substr(-8)}`;
  }
  export function getIdFromDoc(doc: DbUserActionDoc) {
    const parts = doc._id!.split('-a');
    return parseInt(parts[1]);
  }
  export function getIdLast(gameId: string) {
    return `${gameId}-a\ufff0`;
  }
}
