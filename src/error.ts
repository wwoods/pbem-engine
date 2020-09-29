
import _debugCreate from 'debug';

interface DebugCreate {
  (v: any): void;
  enable(prefix: string): void;
}
function _debugCreate_inner(name: string): {(v: any): void} {
  const dbg = _debugCreate(name);
  return ((v: any) => {
    if (v instanceof Error) {
      dbg(v.toString());
      if (dbg.enabled) {
        console.log(v);
      }
    }
    else {
      dbg(v);
    }
  }) as DebugCreate;
}
export const debugCreate = _debugCreate_inner as any as DebugCreate;
debugCreate.enable = _debugCreate.enable.bind(_debugCreate);


export class PbemError extends Error {
  constructor(message?: string) {
    super(message);

    // https://stackoverflow.com/a/48342359/160205
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) Object.setPrototypeOf(this, actualProto);
    else (this as any).__proto__ = actualProto;
  }
}

