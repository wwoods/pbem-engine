
export {DbUser} from '../server/db';

export type DbLocal = DbLocalUsersDoc | DbLocalUserPlaceholderDoc;

export type DbLocalUserPlaceholderDoc = {
  type: 'user-local-placeholder';
};

/** Holds local configuration information */
export interface DbLocalUsersDoc {
  userLoginLatestId?: string;
  users: Array<DbLocalUserDefinition>;
}

export type DbLocalUserDefinition = {
  // The user's local display name (on this device).
  name: string;
  // The user's unique ID on this device.  The remote ID, if one exists, is
  // also populated within the user's database itself.
  localId: string;
  // The user's other unique-ish local IDs and local ID on current device, put
  // into one array.
  localIdAll: string[];
  // The user's unique remote ID.
  remoteId?: string;
};

