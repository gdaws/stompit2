import { Socket, SocketConnectOpts, createConnection } from 'net';
import { clearInterval } from 'timers';
import { Transport, TransportLimits } from '../transport';
import { Result, VoidResult, success, fail } from '../result';
import { Reader } from '../stream/reader';
import { Chunk } from '../stream/chunk';
import { streamFromReadable } from '../stream/readable';
import { FrameHeaders } from '../frame/header';
import { Frame, ProtocolVersion } from '../frame/protocol';
import { readFrame } from '../frame/input';
import { writeFrame } from '../frame/output';
import { RECEIPT_NOT_REQUESTED } from '../client/receipt';

export class NetSocket implements Transport {

  private socket: Socket;

  private limits: TransportLimits;

  private reader: Reader;
  private writing: boolean;

  private readRateTimer: NodeJS.Timeout | undefined;
  private writeRateTimer: NodeJS.Timeout | undefined;

  private sessionStarted: boolean;
  private sessionClosed: boolean;

  public constructor(socket: Socket, limits: TransportLimits, sessionStarted: boolean = false) {

    this.socket = socket;

    this.limits = limits;

    this.reader = new Reader(streamFromReadable(socket));

    this.writing = false;

    this.sessionStarted = sessionStarted;
    this.sessionClosed = false;
  }

  public static getLimitDefaults(): TransportLimits {
    return {
      operationTimeout: 3000,
      desiredReadRate: 3000,
      desiredWriteRate: 0,
      delayTolerance: 400,
      readLimits: {
        maxHeaderLines: 128,
        maxLineLength: 8000,
        maxBodyLength: Infinity,
        maxBodyChunkLength: 16384
      },
      writeLimits: {
        bufferSize: 16384
      }
    };
  }

  public static connect(options: SocketConnectOpts, limits?: Partial<TransportLimits>, sessionStarted: boolean = false): Promise<Result<NetSocket>> {
    return new Promise((resolve) => {
      const socket = createConnection(options, () => {
        const limitDefaults = NetSocket.getLimitDefaults();
        resolve(success(new NetSocket(socket, {...limitDefaults, ...(limits || {})}, sessionStarted)));
      });
      socket.once('error', (error) => {
        resolve(fail(error));
      });
    });
  }

  /**
   * @hidden
   */
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

  /**
   * @inheritdoc
   */
  public getReceiptTimeout(frame: Frame) {

    if ('DISCONNECT' === frame.command || 'UNSUBSCRIBE' === frame.command) {
      return this.limits.operationTimeout;
    }

    return RECEIPT_NOT_REQUESTED;
  }

  /**
   * @inheritdoc
   */
  public async readFrame(protocolVersion: ProtocolVersion) {

    if (this.sessionClosed) {
      return fail(new Error('Network connection closed'));
    }

    const params = {
      ...this.limits.readLimits,
      protocolVersion,
      ignoreLeadingEmptyLines: this.sessionStarted
    };

    const result = await readFrame(this.reader, params);

    if (result.error) {
      this.socket.destroy();
      return fail(result.error);
    }

    if (!this.sessionStarted) {

      const frame = result.value;

      if('CONNECTED' === frame.command) {

        this.sessionStarted = true;

        const heartBeatString = frame.headers.get('heart-beat');

        if (undefined !== heartBeatString) {

          const heartBeatTokens = heartBeatString.match(/^(\d+),(\d+)$/);

          if (null === heartBeatTokens) {
            this.socket.destroy();
            return fail(new Error('invalid heart-beat header'));
          }

          const serverWriteRate = parseInt(heartBeatTokens[1], 10);
          const serverReadRate = parseInt(heartBeatTokens[2], 10);

          const clientWriteRate = this.limits.desiredWriteRate;
          const clientReadRate = this.limits.desiredReadRate;

          const enableWriteRate = 0 !== serverReadRate && 0 !== clientWriteRate;
          const writeRate = enableWriteRate ? Math.max(clientWriteRate, serverReadRate) : undefined;

          if (writeRate) {
            this.monitorWriteRate(writeRate);
          }

          const enableReadRate = 0 !== serverWriteRate && 0 !== clientReadRate;
          const readRate = enableReadRate ? Math.max(clientReadRate, serverWriteRate) : undefined;

          if (readRate) {
            this.monitorReadRate(readRate + this.limits.delayTolerance);
          }
        }
      }
    }

    return result;
  }

  /**
   * @inheritdoc
   */
  public async writeFrame(frame: Frame, protocolVersion: ProtocolVersion) {

    const params = {
      ...this.limits.writeLimits,
      protocolVersion
    };

    switch (frame.command) {

      case 'CONNECT': {

        if (this.sessionStarted) {
          return new Error('session already started');
        }

        if (frame.headers.has('heart-beat')) {
          frame.headers = frame.headers.filter(([name, _value]) => 'heart-beat' === name);
        }

        const writeRate = this.limits.desiredWriteRate;
        const readRate = this.limits.desiredReadRate;

        if (writeRate > 0 || readRate > 0) {

          frame.headers = FrameHeaders.merge(frame.headers, new FrameHeaders([
            ['heart-beat', [
              Math.max(0, writeRate).toFixed(), 
              Math.max(0, readRate).toFixed()
            ].join(',')]
          ]));
        }

        break;
      }

      case 'CONNECTED': {

        if (this.sessionStarted) {
          return new Error('session already started');
        }

        this.sessionStarted = true;

        // TODO implement support for heart beating server side

        frame.headers = FrameHeaders.merge(frame.headers, new FrameHeaders([
          ['heart-beat', '0,0']
        ]));

        break;
      }
    }

    this.writing = true;

    const result = await writeFrame(frame, this, params);
  
    this.writing = false;

    return result;
  }

  /**
   * @inheritdoc
   */
  public close() {

    this.sessionClosed = true;

    if (this.readRateTimer) {
      clearInterval(this.readRateTimer);
      this.readRateTimer = undefined;
    }

    if (this.writeRateTimer) {
      clearInterval(this.writeRateTimer);
      this.writeRateTimer = undefined;
    }

    if(this.socket.destroyed) {
      return;
    }

    this.socket.end();
  }

  private monitorReadRate(milliseconds: number) {

    let lastBytesRead = this.socket.bytesRead;
    
    this.readRateTimer = setInterval(() => {

      const bytesRead = this.socket.bytesRead;

      if (bytesRead === lastBytesRead) {
        this.socket.destroy(new Error('session timeout'));
        return false;
      }

      lastBytesRead = bytesRead;
      return true;

    }, milliseconds);
  }

  private monitorWriteRate(milliseconds: number) {

    let lastBytesWritten = this.socket.bytesWritten;

    const LF = Buffer.from('\n', 'ascii');

    this.writeRateTimer = setInterval(() => {

      const bytesWritten = this.socket.bytesWritten;

      if (bytesWritten === lastBytesWritten && !this.writing) {
        this.write(LF);
      }

      lastBytesWritten = bytesWritten;

    }, milliseconds);
  }
}
