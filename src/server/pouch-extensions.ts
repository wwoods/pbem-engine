// Namespace extension
declare namespace PouchDB {
  export interface Database<Content extends {} = {}> {
    findContinuous(
      selector: PouchDB.Find.Selector,
      callback: (arg: Content) => void,
      callbackInitial?: (noMatches: boolean) => void,
    ): FindContinuousCancel;

    /** Find DB name without remote host information.  That is, the ID
     * of the database, regardless of where it's hosted. */
    dbName(): string;
    getUuid(): string;
  }

  export interface FindContinuousCancel {
    cancel: () => void;
  }
}

