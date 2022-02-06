import { Result } from '../result';
import { Chunk } from '../stream/chunk';
import { FrameHeaders } from './header';

export const HEADER_CHAR_ENCODING = 'utf-8';

export const STOMP_VERSION_10 = '1.0';
export const STOMP_VERSION_11 = '1.1';
export const STOMP_VERSION_12 = '1.2';

export type ProtocolVersion =
  typeof STOMP_VERSION_10 |
  typeof STOMP_VERSION_11 |
  typeof STOMP_VERSION_12
  ;

export function acceptedVersions(): ProtocolVersion[] {
  return [
    STOMP_VERSION_10,
    STOMP_VERSION_11,
    STOMP_VERSION_12
  ];
}

export function supportedProtocolVersion(version: any): ProtocolVersion | undefined {
  const versions = acceptedVersions()
  const index = versions.indexOf(version);

  if (index === -1) {
    return;
  }

  return versions[index];
}

export type FrameBodyChunk = Result<Chunk>;
export type FrameBody = AsyncGenerator<FrameBodyChunk>;

/**
 * Represents a frame inbound or outbound
 */
export interface Frame {

  /**
   * Standard client commands:
   *  * CONNECT
   *  * STOMP
   *  * SEND
   *  * SUBSCRIBE
   *  * UNSUBSCRIBE
   *  * ACK
   *  * NACK
   *  * BEGIN
   *  * COMMIT
   *  * ABORT
   *  * DISCONNECT
   *
   * Standard server commands:
   *  * CONNECTED
   *  * MESSAGE
   *  * ERROR
   */
  command: string;

  /**
   * The header lines
   */
  headers: FrameHeaders;

  /**
   * The unread or unwritten body
   */
  body: FrameBody;
}

export type AckMode = 'auto' | 'client' | 'client-individual';

export function acceptedAckModes(_protocolVersion: ProtocolVersion): AckMode[] {
  return [
    'auto',
    'client',
    'client-individual'
  ];
}

export function getAckMode(value: any, protocolVersion: ProtocolVersion): AckMode | undefined {
  if (undefined === value) {
    return 'auto';
  }

  const modes = acceptedAckModes(protocolVersion);

  const index = modes.indexOf(value);

  if (index === -1) {
    return;
  }

  return modes[index];
}
