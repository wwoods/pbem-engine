// Some sort of typescript naming issue; moving @types/pouchdb to
// "dependencies" in pbem-engine sounds like it should resolve this, but it
// does not.  So, make the declaration locally as a stub, as client
// applications should not be directly referencing PouchDB anyway.
declare namespace PouchDB {
  export interface Database<Content extends {} = {}> {}
}
