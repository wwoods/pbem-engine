// Namespace extension
declare namespace PouchDB {
  export interface Database<Content extends {} = {}> {
    findContinuous(
      selector: PouchDB.Find.Selector,
      callback: (arg: Content) => void,
      callbackInitial?: (noMatches: boolean) => void,
    ): FindContinuousCancel;

    getUuid(): string;
  }

  export interface FindContinuousCancel {
    cancel: () => void;
  }
}

