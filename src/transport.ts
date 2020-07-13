import { Result, VoidResult, success, fail } from './result';
import { Chunk } from './stream/chunk';
import { Reader } from './stream/reader';
import { ReadLimits, readFrame } from './frame/input';
import { WriteLimits, writeFrame } from './frame/output';
import { Frame, ProtocolVersion } from './frame/protocol';
import { FrameHeaders } from './frame/header';
import { RECEIPT_NOT_REQUESTED } from './client/receipt';

type Milliseconds = number;

/**
 * The transport interface for a STOMP session.
 * 
 * Support for the Heart-beating feature is the responsibility of the transport implementation. If the feature is 
 * unsupported the transport must omit the `heart-beat` header or specify a value of `0,0`.
 */
export interface Transport {

  /**
   * Returns the suggested timeout value for a receipt. This function is only useful for client sessions.
   * 
   * Possible values:
   * * Milliseconds as positive integer,
   * * {@link RECEIPT_NO_TIMEOUT},
   * * {@link RECEIPT_NOT_REQUESTED}
   * 
   * If a transport returns {@link RECEIPT_DEFAULT_TIMEOUT} then the client session translate this value to {@link RECEIPT_NOT_REQUESTED}
   */
  getReceiptTimeout(frame: Frame): Milliseconds;

  /**
   * Receive the next incoming frame. The return value may resolve before the frame is fully deserialized. The transport 
   * may only read as far as the end of the frame header to then let the caller control reading the frame body.
   * 
   * The STOMP session implementation must not call this function before the previous frame's body has been fully read.
   */
  readFrame(protocolVersion: ProtocolVersion): Promise<Result<Frame>>;

  /**
   * Send the next outgoing frame. The return value resolves once the frame has been fully serialised and sent for 
   * transmission.
   */
  writeFrame(frame: Frame, protocolVersion: ProtocolVersion): Promise<Error | undefined>;

  /**
   * Close the connection.
   */
  close(): Promise<void>;
};

/**
 * A base class for a transport's configuration class. This is useful for transport implementations that use the
 * {@link readFrame} and {@link writeFrame} functions.
 */
export interface TransportLimits {

  operationTimeout: Milliseconds;

  /**
   * The desired minimum rate of incoming data from the connection peer. The actual expected rate is negotiated with 
   * the connection peer as the session is establishing. If no data is received during the interval then the connection
   * is dead.
   */
  desiredReadRate: Milliseconds;

  /**
   * The desired minimum rate of outgoing data to the connection peer. See {@link desiredReadRate} for intended behaviour, 
   * but applies to outgoing data.
   */
  desiredWriteRate: Milliseconds;

  /**
   * The delay tolerance value adds time to the unresponsive state threshold.
   */
  delayTolerance: Milliseconds;

  /**
   * Read frame size limits
   */
  readLimits: ReadLimits;

  /**
   * Write frame size limits
   */
  writeLimits: WriteLimits;
};

export const limitDefaults: TransportLimits = {
  operationTimeout: 3000,
  desiredReadRate: 3000,
  desiredWriteRate: 0,
  delayTolerance: 3000,
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

/**
 * Used by the transport to perform byte-level communication with the peer
 */
export interface TransportStream extends AsyncIterable<Chunk> {

  /**
   * The running total amount of bytes received
   */
  readonly bytesRead: number;

  /**
   * The running total amount of bytes sent
   */
  readonly bytesWritten: number;

  /**
   * Send data
   * 
   * @param chunk Byte array
   */
  write(chunk: Chunk): Promise<VoidResult>;

  /**
   * Signal the end of writing operations
   */
  writeEnd(): Promise<VoidResult>;

  /**
   * Close the stream and release the associated resources
   */
  close(): void;
};

const ERROR_SESSION_TIMEOUT = 'session timeout';
const ERROR_SESSION_CLOSED = 'session closed';
const ERROR_SESSION_ALREADY_STARTED = 'session already started';

/**
 * A transport implementation that serialises frames in the standard format and observes the standard protocol.
 */
export class StandardTransport implements Transport {

  private stream: TransportStream;
  private streamError: Error | undefined;

  private reader: Reader;

  private writing: boolean;

  private limits: TransportLimits;

  private readRateTimer: NodeJS.Timeout | undefined;
  private writeRateTimer: NodeJS.Timeout | undefined;

  private sessionStarted: boolean;
  private sessionClosed: boolean;

  /**
   * @param stream The underlying stream used to transmit frames
   * @param limits Time and size limits to place on the transport
   * @param sessionStarted Pass true value if the session is already established
   */
  public constructor(stream: TransportStream, limits: TransportLimits, sessionStarted: boolean = false) {

    this.stream = stream;

    this.limits = limits;

    this.reader = new Reader(stream[Symbol.asyncIterator]());

    this.writing = false;

    this.sessionStarted = sessionStarted;
    this.sessionClosed = false;
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
      return fail(this.streamError ? this.streamError : new Error(ERROR_SESSION_CLOSED));
    }

    const params = {
      ...this.limits.readLimits,
      protocolVersion,
      ignoreLeadingEmptyLines: this.sessionStarted
    };

    const result = await readFrame(this.reader, params);

    if (result.error) {
      return this.failStream(result.error);
    }

    if (!this.sessionStarted) {

      const frame = result.value;

      if('CONNECTED' === frame.command) {

        this.sessionStarted = true;

        const heartbeat = this.startHeartBeat(frame.headers);

        if (heartbeat.error) {
          return this.failStream(heartbeat.error);
        }
      }
    }

    return result;
  }

  /**
   * @inheritdoc
   */
  public async writeFrame(frame: Frame, protocolVersion: ProtocolVersion) {

    if (this.sessionClosed) {
      return this.streamError ? this.streamError : new Error(ERROR_SESSION_CLOSED);
    }

    const params = {
      ...this.limits.writeLimits,
      protocolVersion
    };

    switch (frame.command) {

      case 'CONNECT': {

        if (this.sessionStarted) {
          return this.failStream(new Error(ERROR_SESSION_ALREADY_STARTED)).error;
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
          return this.failStream(new Error(ERROR_SESSION_ALREADY_STARTED)).error;
        }

        this.sessionStarted = true;

        const heartbeat = this.startHeartBeat(frame.headers, false);

        if (heartbeat.error) {
          return this.failStream(heartbeat.error).error;
        }

        const [sendRate, recvRate] = heartbeat.value;

        frame.headers = FrameHeaders.merge(frame.headers, new FrameHeaders([
          ['heart-beat', `${sendRate},${recvRate}`]
        ]));

        break;
      }
    }

    this.writing = true;

    const result = await writeFrame(frame, this.stream, params);
  
    this.writing = false;

    if ('CONNECTED' === frame.command) {
      this.startHeartBeat(frame.headers, true);
    }

    return result;
  }

  private failStream(error: Error) {

    if (this.streamError) {
      return fail(this.streamError);
    }

    this.streamError = error;

    this.close();

    return fail(error);
  }

  /**
   * @inheritdoc
   */
  public close() {

    if (this.sessionClosed) {
      return Promise.resolve();
    }

    this.sessionClosed = true;

    if (this.readRateTimer) {
      clearInterval(this.readRateTimer);
      this.readRateTimer = undefined;
    }

    if (this.writeRateTimer) {
      clearInterval(this.writeRateTimer);
      this.writeRateTimer = undefined;
    }

    return (async () => {

      if (!this.streamError) {

        const error = await this.stream.writeEnd();

        if (error) {
          this.streamError = error;
        }
      }
  
      this.stream.close();
    })();
  }

  private startHeartBeat(headers: FrameHeaders, monitor: boolean = true): Result<[number, number]> {

    const heartBeatString = headers.get('heart-beat');

    if (undefined === heartBeatString) {
      return success([0, 0]);
    }

    const heartBeatTokens = heartBeatString.match(/^(\d+),(\d+)$/);

    if (null === heartBeatTokens) {
      return fail(new Error('invalid heart-beat header'));
    }

    const remoteWriteRate = parseInt(heartBeatTokens[1], 10);
    const remoteReadRate = parseInt(heartBeatTokens[2], 10);

    const localWriteRate = this.limits.desiredWriteRate;
    const localReadRate = this.limits.desiredReadRate;

    const enableWriteRate = 0 !== remoteReadRate && 0 !== localWriteRate;
    const writeRate = enableWriteRate ? Math.max(localWriteRate, remoteReadRate) : 0;

    if (writeRate > 0 && monitor) {
      this.monitorWriteRate(writeRate);
    }

    const enableReadRate = 0 !== remoteWriteRate && 0 !== localReadRate;
    const readRate = enableReadRate ? Math.max(localReadRate, remoteWriteRate) : 0;

    if (readRate > 0 && monitor) {
      this.monitorReadRate(readRate + this.limits.delayTolerance);
    }

    return success([writeRate, readRate]);
  }

  private monitorReadRate(milliseconds: number) {

    let lastBytesRead = this.stream.bytesRead;
    
    this.readRateTimer = setInterval(() => {

      const bytesRead = this.stream.bytesRead;

      if (bytesRead === lastBytesRead) {
        this.failStream(new Error(ERROR_SESSION_TIMEOUT));
        return;
      }

      lastBytesRead = bytesRead;

    }, milliseconds);
  }

  private monitorWriteRate(milliseconds: number) {

    let lastBytesWritten = this.stream.bytesWritten;

    const LF = Buffer.from('\n', 'ascii');

    this.writeRateTimer = setInterval(() => {

      let bytesWritten = this.stream.bytesWritten;

      if (bytesWritten === lastBytesWritten && !this.writing) {
        this.stream.write(LF);
        bytesWritten += 1;
      }

      lastBytesWritten = bytesWritten;

    }, milliseconds);
  }
}
