import { Socket, SocketConnectOpts, createConnection } from 'net';
import { Result, success, fail } from '../result';
import { Chunk } from '../stream/chunk';
import { VoidResult } from '../result';

import { 
  TransportStream, 
  TransportLimits,
  StandardTransport,
  limitDefaults
} from '../transport';

export class NetSocketStream implements TransportStream {

  private socket: Socket;

  public constructor(socket: Socket) {
    this.socket = socket;
  }

  get bytesRead() {
    return this.socket.bytesRead;
  }

  get bytesWritten() {
    return this.socket.bytesWritten;
  }

  public [Symbol.asyncIterator](): AsyncIterator<Chunk> {
    return this.socket[Symbol.asyncIterator]();
  }

  public write(chunk: Chunk): Promise<VoidResult> {
    return new Promise((resolve) => {
      this.socket.write(chunk, (error) => {
        if (error) {
          resolve(error);
          return;
        }
        setImmediate(resolve);
      });
    });
  }

  public writeEnd(): Promise<VoidResult> {
    return new Promise((resolve) => {
      this.socket.end(() => {
        resolve();
      });
    });
  }

  public close() {
    this.socket.destroy();
  }
}

export function createNetTransport(options: SocketConnectOpts, limits?: Partial<TransportLimits>): Promise<Result<StandardTransport>> {

  return new Promise((resolve) => {
    const socket = createConnection(options, () => {
      const stream = new NetSocketStream(socket);
      resolve(success(new StandardTransport(stream, {...limitDefaults, ...(limits || {})})));
    });
    socket.once('error', (error) => {
      resolve(fail(error));
    });
  });
}
