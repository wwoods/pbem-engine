import PouchDb from 'pouchdb';
import PouchDbFind from 'pouchdb-find';
import PouchDbUpsert from 'pouchdb-upsert';
PouchDb.plugin(PouchDbFind);
PouchDb.plugin(PouchDbUpsert);
PouchDb.plugin(<PouchDB.Plugin><any>{
  /** Calls callback with both current versions (EXCLUDING DELETED!) and
   * changes-versions of the given selector.
   * */
  findContinuous<DbType>(this: PouchDB.Database<DbType>, selector: any,
      callback: (arg: DbType) => void): PouchDB.FindContinuousCancel {
    const watcher = this.changes({
      since: 'now',
      live: true,
      include_docs: true,
      selector,
    });
    watcher.on('change', (change: any) => {
      callback(change.doc as DbType);
    });
    (async () => {
      const docs = (await this.find({selector})).docs;
      for (const d of docs) {
        callback(d);
      }
    })().catch(e => {
      watcher.emit('error', e);
    });
    return watcher;
  },
});

export default PouchDb;

