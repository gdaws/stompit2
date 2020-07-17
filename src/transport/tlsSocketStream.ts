import { connect, ConnectionOptions } from 'tls';
import { Result, ok, fail } from '../result';

import { 
  TransportLimits,
  StandardTransport,
  limitDefaults
} from '../transport';

import { NetSocketStream } from './netSocketStream';

export function tlsConnect(options: ConnectionOptions, limits?: Partial<TransportLimits>): Promise<Result<StandardTransport>>{
  return new Promise((resolve) => {
    const socket = connect(options, () => {
      const stream = new NetSocketStream(socket);
      resolve(ok(new StandardTransport(stream, {...limitDefaults, ...(limits || {})})));
    });
    socket.once('error', (error) => {
      resolve(fail(error));
    });
  });
}
