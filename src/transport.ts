import { Result } from './result';
import { ReadLimits } from './frame/input';
import { WriteLimits } from './frame/output';
import { Frame, ProtocolVersion } from './frame/protocol';

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
  close(): void;
};

export const TRANSMISSION_RATE = 0;

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
