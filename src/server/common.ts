
import {PbemError} from '../error';
import {_PbemSettings, _PbemState} from '../game';

export const ServerGameIdPrefixes = {
  Local: 'l-',
};

export namespace ServerError {
  export class ServerError extends PbemError {}
  export class GameIsStagingError extends ServerError {
    constructor(gameId: string) {
      super(`Game is staging: ${gameId}`);
    }
  }
  export class NoSuchGameError extends ServerError {
    constructor(gameId: string) {
      super(`No such game: ${gameId}`);
    }
  }
  export class NotLoggedInError extends ServerError {
    constructor() {
      super("Not logged in");
    }
  }
}

export interface ServerStagingResponse<Settings> {
  isPastStaging: boolean;
  settings: Settings;
}

export interface _Server {
  /** Returns gameId / sets settings.gameId to same value. */
  stagingCreate<Settings extends _PbemSettings>(settings: Settings): Promise<string>;

  /** Load settings based on gameId */
  stagingLoad<Settings extends _PbemSettings>(gameId: string): Promise<ServerStagingResponse<Settings>>;

  /** Start game with chosen settings */
  stagingStartGame<Settings extends _PbemSettings>(settings: Settings): Promise<void>;

  /** Load game state based on gameId */
  gameLoad<State extends _PbemState>(gameId: string): Promise<State>;
}

