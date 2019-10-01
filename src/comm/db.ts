
export {DbUser} from '../server/db';

/** Holds local configuration information */
export interface DbLocal {
  userLoginLatestId?: string;
  users: DbLocalUsers;
}

export type DbLocalUserDefinition = {
  name: string;
  idLocal: string;
  idRemote?: string;
};

export type DbLocalUsers = Array<DbLocalUserDefinition>;
