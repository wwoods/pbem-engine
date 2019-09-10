
export class PbemError extends Error {
  constructor(message?: string) {
    super(message);

    // https://stackoverflow.com/a/48342359/160205
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) Object.setPrototypeOf(this, actualProto);
    else (this as any).__proto__ = actualProto;
  }
}

