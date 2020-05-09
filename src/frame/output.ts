import { Result, success, fail } from '../result';
import { alloc, allocUnsafe, encodeUtf8String } from '../stream/chunk';
import { Writer } from '../stream/writer';

import {
  Frame, 
  ProtocolVersion, 
  HEADER_CHAR_ENCODING, 
  STOMP_VERSION_10, 
  STOMP_VERSION_11, 
  STOMP_VERSION_12 
} from './protocol';

const NUL = 0;
const LF = 10;

export interface WriteLimits {

  /**
   * The size of the internal buffer used for serialisation.
   */
  bufferSize: number;
};

/**
 * The parameters object for a writeFrame call
 */
export interface WriteParameters extends WriteLimits {

  /**
   * STOMP protocol version of the session
   */
  protocolVersion: ProtocolVersion;
};

/**
 * Serialize a frame to an output stream.
 * 
 * The return value is resolved when the header and body are written to the output stream.
 * 
 * A single write operation is made if the serialised frame is small enough to fit in the internal buffer, otherwise
 * a write operation is made for the header and then a write operation per iteration of the body chunks.
 */
export async function writeFrame(frame: Frame, writer: Writer, params: WriteParameters): Promise<Error | undefined> {

  let buffer = allocUnsafe(params.bufferSize);
  let writeEnd = buffer.length;

  let frameHeader = frame.command + '\n';

  let expectedContentLength;

  const emptyBodyCommands = /^(RECEIPT|CONNECT|CONNECTED|SUBSCRIBE|UNSUBSCRIBE|ACK|NACK|BEGIN|COMMIT|ABORT|DISCONNECT)$/;

  if (frame.command.match(emptyBodyCommands)) {
    expectedContentLength = 0;
  }

  for (const [name, value] of frame.headers) {

    if (name.toLowerCase() === 'content-length') {

      expectedContentLength = Number.parseInt(value, 10);

      if(Number.isNaN(expectedContentLength) || expectedContentLength < 0) {
        return new Error('invalid content-length header');
      }
    }

    const nameEncoded = encodeValue(name, params);
    
    if (nameEncoded.error) {
      return nameEncoded.error;
    }

    const valueEncoded = encodeValue(value, params);

    if (valueEncoded.error) {
      return valueEncoded.error;
    }

    frameHeader = frameHeader + nameEncoded.value + ':' + valueEncoded.value + '\n';
  }

  frameHeader = frameHeader + '\n';

  // Copy the frame header string into the buffer

  const frameHeaderChunk = encodeUtf8String(frameHeader);

  let written = 0;

  if (frameHeaderChunk.length < buffer.length) {
    buffer.set(frameHeaderChunk, 0);
    written = frameHeaderChunk.length;
  }
  else {
    buffer = frameHeaderChunk;
    writeEnd = buffer.length;
    written = writeEnd;
  }

  if (undefined !== expectedContentLength && written + expectedContentLength + 2 < writeEnd) {

    // The frame body size is known and it and the frame header are small enough to fit
    // in the buffer and let us make a single write call to the transport

    let contentLength = 0;

    for await (const chunk of frame.body) {
      
      if (chunk.error) {
        return chunk.error;
      }

      contentLength += chunk.value.length;

      if (contentLength > expectedContentLength) {
        return new Error('incorrect content-length header');
      }

      buffer.set(chunk.value, written);

      written += chunk.value.length;
    }

    if (contentLength !== expectedContentLength) {
      return new Error('incorrect content-length header');
    }

    buffer[written] = NUL;
    buffer[written + 1] = LF;

    written += 2;

    const error = await writer.write(buffer.slice(0, written));

    if (error) {
      return error;
    }
  }
  else {

    // The body size is unknown therefore we make a write call to the 
    // transport for each body chunk

    const writeHeaderError = await writer.write(buffer.slice(0, written));

    if (writeHeaderError) {
      return writeHeaderError;
    }

    for await (const chunk of frame.body) {

      if (chunk.error) {
        return chunk.error;
      }

      const writeChunkError = await writer.write(chunk.value);

      if (writeChunkError) {
        return writeChunkError;
      }
    }

    buffer[0] = NUL;
    buffer[1] = LF;

    const writeTrailerError = await writer.write(buffer.slice(0, 2));

    if (writeTrailerError) {
      return writeTrailerError;
    }
  }

  return;
}

function encodeEscapeSequence(value: string) {

  switch (value) {
    
    case '\r':
      return '\\r';

    case '\n':
      return '\\n';
    
    case ':':
      return '\\c';
    
    case '\\':
      return '\\\\';

    default:
      return value;
  }
}

function encodeValue(decoded: string, params: WriteParameters): Result<string> {

  switch (params.protocolVersion) {

    case STOMP_VERSION_10:
      return success(decoded);
    
    case STOMP_VERSION_11:
      return success(decoded.replace(/\n|:|\\|/g, encodeEscapeSequence));

    case STOMP_VERSION_12:
      return success(decoded.replace(/\r|\n|:|\\|/g, encodeEscapeSequence));
  }
}
