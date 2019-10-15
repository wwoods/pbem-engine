import PouchDb from 'pouchdb';
import PouchDbFind from 'pouchdb-find';
import PouchDbUpsert from 'pouchdb-upsert';
import './pouch-extensions';
PouchDb.plugin(PouchDbFind);
PouchDb.plugin(PouchDbUpsert);
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

export default PouchDb;

