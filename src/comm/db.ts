
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
  // populated within the user's database itself.
  localId: string;
};

