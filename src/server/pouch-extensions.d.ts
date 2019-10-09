// Namespace extension
declare namespace PouchDB {
  interface Database<Content extends {} = {}> {
    findContinuous(selector: PouchDB.Find.Selector,
      callback: (arg: Content) => void): FindContinuousCancel;
  }

  interface FindContinuousCancel {
    cancel: () => void;
  }
}

