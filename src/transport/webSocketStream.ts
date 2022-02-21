/// <reference lib="dom" />

import { Result, ok, fail } from '../result';
import { StompitError } from '../error';
import { Chunk, encodeUtf8String } from '../stream/chunk';
import { createQueue, Producer } from '../queue';

import {
  TransportStream,
  TransportLimits,
  StandardTransport,
  limitDefaults
} from '../transport';

export class WebSocketStream implements TransportStream {
  private socket: WebSocket;

  private socketInput: AsyncIterable<Chunk>;

  private socketOutputQueue: Producer<Chunk>;

  public bytesRead: number;

  public bytesWritten: number;

  public constructor(socket: WebSocket) {
    this.socket = socket;

    this.bytesRead = 0;

    this.bytesWritten = 0;

    const [inputQueue, pullInputQueue] = createQueue<Chunk>();
    const [outputQueue, pullOutputQueue] = createQueue<Chunk>();

    this.socketInput = pullInputQueue;
    this.socketOutputQueue = outputQueue;

    socket.addEventListener('message', (event) => {
      const data = event.data;

      if (data instanceof ArrayBuffer) {
        inputQueue.push(new Uint8Array(data));
        return;
      }

      if (typeof data === 'string') {
        inputQueue.push(encodeUtf8String(data));
        return;
      }

      if (data instanceof Blob) {
        data.arrayBuffer().then(arrayBuffer => {
          inputQueue.push(new Uint8Array(arrayBuffer));
        });
        return;
      }
    });

    socket.addEventListener('close', () => {
      inputQueue.terminate();
    });

    (async () => {
      for await (const chunk of pullOutputQueue) {
        try {
          await this.socketReady();
        }
        catch (error) {
          return;
        }

        socket.send(chunk);
      }

      socket.close();
    })();
  }

  private socketReady() {
    if (this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.socket.readyState === WebSocket.CLOSED) {
      return Promise.reject(new Error('socket is closed'));
    }

    return new Promise<void>((resolve, reject) => {
      const opened = () => {
        resolve();
        this.socket.removeEventListener('open', opened);
      };

      const closed = () => {
        reject(new Error('socket closed'));
        this.socket.removeEventListener('close', closed);
      };

      this.socket.addEventListener('open', opened);
      this.socket.addEventListener('close', closed);
    });
  }

  public async *[Symbol.asyncIterator]() {
    for await (const chunk of this.socketInput) {
      this.bytesRead += chunk.byteLength;

      yield chunk;
    }
  }

  public async write(chunk: Chunk): Promise<StompitError | undefined> {
    if (this.socket.readyState === WebSocket.CLOSED) {
      return new StompitError('TransportFailure', 'socket is closed');
    }

    if (this.socket.readyState === WebSocket.CLOSING) {
      return new StompitError('TransportFailure', 'socket is closing');
    }

    this.socketOutputQueue.push(chunk);

    try {
      await this.socketOutputQueue.drained();
    }
    catch (error) {
      if (error instanceof StompitError) {
        return error;
      }
      else {
        return new StompitError('TransportFailure', 'write error');
      }
    }

    this.bytesWritten += chunk.byteLength;
  }

  public async writeEnd(): Promise<StompitError | undefined> {
    this.socketOutputQueue.terminate();

    try {
      await this.socketOutputQueue.drained();
    }
    catch (error) {
      if (error instanceof StompitError) {
        return error;
      }
      else {
        return new StompitError('TransportFailure', 'write error');
      }
    }
  }

  public close() {
    this.socket.close();
  }
}

export function wsConnect(url: string, limits?: Partial<TransportLimits>): Promise<Result<StandardTransport>> {
  return new Promise((resolve) => {
    try {
      const socket = new WebSocket(url);

      socket.binaryType = 'arraybuffer';

      resolve(ok(new StandardTransport(new WebSocketStream(socket), { ...limitDefaults, ...(limits || {}) })));
    }
    catch (error) {
      if (error instanceof StompitError) {
        resolve(fail(error));
      }
      else {
        resolve(fail(new StompitError('TransportFailure', 'connect error')));
      }
    }
  });
}
