import PouchDb from 'pouchdb';
import PouchDbFind from 'pouchdb-find';
import PouchDbUpsert from 'pouchdb-upsert';
import './pouch-extensions';
PouchDb.plugin(PouchDbFind);
PouchDb.plugin(PouchDbUpsert);

declare var performance: any;
if (typeof performance === 'undefined') {
  performance = undefined;
}
declare var window: any;
window.PouchDb = PouchDb;
PouchDb.plugin(<PouchDB.Plugin><any>{
  /** Calls callback with both current versions (EXCLUDING DELETED!) and
   * changes-versions (INCLUDING DELETED!) of the given selector.
   *
   * _delete should only be issued when a document cannot have any further
   * effect, and is forwarded only to stop ongoing processes such as
   * replications.
   *
   * In other words, documents should only be deleted if they are completely
   * handled and require no further action.
   *
   * callbackInitial() is called when the initial search has been completed.
   * If called with `true`, then no matching documents were found.
   * */
  findContinuous<DbType>(this: PouchDB.Database<DbType>,
      selector: any,
      callback: (arg: DbType) => void,
      callbackInitial?: (noMatches: boolean) => void,
  ): PouchDB.FindContinuousCancel {
    const watcher = this.changes({
      since: 'now',
      live: true,
      include_docs: true,
      selector,
    });
    watcher.on('change', (change: any) => {
      // To stop replications, we do want to call the callback with _deleted
      // documents.
      // if (change.deleted) return;
      callback(change.doc as DbType);
    });
    (async () => {
      const docs = (await this.find({selector})).docs;
      for (const d of docs) {
        callback(d);
      }
      if (callbackInitial !== undefined) {
        callbackInitial(docs.length === 0);
      }
    })().catch(e => {
      watcher.emit('error', e);
    });
    return watcher;
  },
});

PouchDb.plugin(<PouchDB.Plugin><any>{
  getUuid() { // Public Domain/MIT from https://stackoverflow.com/a/8809472/160205
    var d = Date.now();//Timestamp
    var d2 = (performance !== undefined && performance.now 
      && (performance.now()*1000)) || 0;//Time in microseconds since page-load or 0 if unsupported
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16;//random number between 0 and 16
        if(d > 0){//Use timestamp until depleted
            r = (d + r)%16 | 0;
            d = Math.floor(d/16);
        } else {//Use microseconds since page-load if supported
            r = (d2 + r)%16 | 0;
            d2 = Math.floor(d2/16);
        }
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
});

export default PouchDb;

