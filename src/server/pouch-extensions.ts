// Namespace extension
declare namespace PouchDB {
  export interface Database<Content extends {} = {}> {
    findContinuous(
      selector: PouchDB.Find.Selector,
      callback: (arg: Content) => void,
      callbackNoMatch?: () => void,
    ): FindContinuousCancel;
  }

  export interface FindContinuousCancel {
    cancel: () => void;
  }
}

