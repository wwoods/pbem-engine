
import {_PbemSettings, _PbemState, _PbemAction} from '../game';
import {ServerStagingResponse} from '../server/common';

export interface CommCommon {
  gameId: string;

  connect(gameId: string): Promise<void>;
  close: {(): Promise<void>};
  stagingCreate: {<Settings extends _PbemSettings>(s: Settings): Promise<void>};
  stagingLoad: {<Settings extends _PbemSettings>(): Promise<ServerStagingResponse<Settings>>};
  stagingStartGame: {<Settings extends _PbemSettings>(s: Settings): Promise<void>};
  gameActions: {(action: _PbemAction[]): Promise<void>};
  gameLoad: {<State extends _PbemState>(): Promise<State>};
}

