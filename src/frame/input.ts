import { Result, success, fail } from '../result';
import { FrameHeaders, HeaderLine } from './header';
import { Reader } from '../stream/reader';
import { Chunk, decodeString } from '../stream/chunk';

import { 
  Frame, 
  ProtocolVersion, 
  HEADER_CHAR_ENCODING, 
  STOMP_VERSION_10, 
  STOMP_VERSION_11, 
  STOMP_VERSION_12 
} from './protocol';

/**
 * Permissible size limits for reading a frame
 */
export interface ReadLimits {

  /**
   * The maximum number of header lines
   */
  maxHeaderLines: number;
  
  /**
   * The maximum line byte length.
   */
  maxLineLength: number;
  
  /**
   * The maximum body byte length.
   * 
   * For unlimited size set `Infinity` value.
   */
  maxBodyLength: number;
  
  /**
   * The body chunk byte length.
   */
  maxBodyChunkLength: number;
};

/**
 * The parameters object for a readFrame call
 */
export interface ReadParameters extends ReadLimits {

  /**
   * Skip empty lines before the beginning of the frame
   */
  ignoreLeadingEmptyLines: boolean;

  /**
   * STOMP protocol version of the session
   */
  protocolVersion: ProtocolVersion;
};

/**
 * Deserialise a frame from an input stream.
 * 
 * The return value resolves when the header has been deserialised. The caller then reads the body by iterating on the
 * `body` property.
 */
export async function readFrame(reader: Reader, params: ReadParameters): Promise<Result<Frame>> {

  const commandResult = await readCommand(reader, params);

  if (commandResult.error) {
    return fail(commandResult.error);
  }

  const command = commandResult.value;

  const headerLines = [];

  for await (const line of readHeaderLines(reader, params)) {

    if (line.error) {
      return fail(line.error);
    }

    headerLines.push(line.value);
  }

  const headers = new FrameHeaders(headerLines);

  let body;

  const contentLengthString = headers.get('content-length');

  if (undefined !== contentLengthString) {
    const contentLength = Number.parseInt(contentLengthString, 10);
    //FIXME check contentLength is not NaN
    body = readFixedSizeBody(reader, contentLength, params);
  }
  else {
    body = readDynamicSizeBody(reader, params);
  }

  return success({
    command,
    headers,
    body
  });
}

async function readCommand(reader: Reader, params: ReadParameters): Promise<Result<string>> {

  const command = await reader.readLine(params.maxLineLength);

  if (command.error) {
    return fail(command.error);
  }

  if (command.value.length === 0) {
    // reading EOL trailer from previous frame
    if (params.ignoreLeadingEmptyLines) {
      return await readCommand(reader, params);
    }
    else {
      return fail(new Error('malformed frame expected command line'));
    }
  }

  return success(decodeString(command.value, HEADER_CHAR_ENCODING));
}

async function* readHeaderLines(reader: Reader, params: ReadParameters): AsyncGenerator<Result<HeaderLine>> {

  let count = 0;

  while (count++ <= params.maxHeaderLines) {

    const line = await reader.readLine(params.maxLineLength);

    if (line.error) {
      yield fail(line.error);
      /* istanbul ignore next */ 
      return;
    }

    if (0 === line.value.length) {
      return;
    }
  
    const lineString = decodeString(line.value, HEADER_CHAR_ENCODING);

    const separator = lineString.indexOf(':');

    if (-1 === separator) {
      yield fail(new Error('header parse error ' + lineString));
      /* istanbul ignore next */ 
      return;
    }

    const name = decodeValue(lineString.substring(0, separator), params);
    const value = decodeValue(lineString.substring(separator + 1), params);

    if (name.error || value.error) {
      yield fail(new Error('header value decode error'));
      /* istanbul ignore next */
      return;
    }

    yield success([name.value, value.value]);
  }

  yield fail(new Error('maximum header lines exceeded'));
}

async function* readFixedSizeBody(reader: Reader, contentLength: number, params: ReadParameters): AsyncGenerator<Result<Chunk>> {

  if (contentLength > params.maxBodyLength) {
    yield fail(new Error('frame body too large'));
    /* istanbul ignore next */ 
    return;
  }

  let remaining = contentLength;

  while (remaining > 0) {

    const chunk = await reader.read(Math.min(remaining, params.maxBodyChunkLength));

    if (chunk.error) {
      yield fail(chunk.error);
      /* istanbul ignore next */ 
      return;
    }

    remaining -= chunk.value.length;

    yield success(chunk.value);
  }

  const end = await reader.read(1);

  if (end.error) {
    yield fail(end.error);
    /* istanbul ignore next */ 
    return;
  }

  if (0x0 !== end.value[0]) {
    yield fail(new Error('expected null byte'));
    /* istanbul ignore next */ 
    return;
  }

  yield success(Buffer.alloc(0));
}

async function* readDynamicSizeBody(reader: Reader, params: ReadParameters): AsyncGenerator<Result<Chunk>> {

  let totalSize = 0;

  while (true) {

    const chunk = await reader.readUntil(0x0, params.maxBodyChunkLength);

    if (chunk.error) {
      yield fail(chunk.error);
      /* istanbul ignore next */ 
      return;
    }

    const ended = 0x0 === chunk.value[chunk.value.length - 1];

    totalSize += chunk.value.length + (ended ? -1 : 0);

    if (totalSize > params.maxBodyLength) {
      yield fail(new Error('frame body too large'));
      /* istanbul ignore next */ 
      return;
    }

    if (ended) {
      yield success(chunk.value.slice(0, chunk.value.length - 1));
      /* istanbul ignore next */ 
      return;
    }
    else {
      yield success(chunk.value);
    }
  }
}

function decodeEscapeSequence(escapeSequence: string) {

  switch (escapeSequence) {
    case '\\r':
      return '\r';
    case '\\n':
      return '\n';
    case '\\c':
      return ':';
    case '\\\\':
      return '\\';
    default:
      /* istanbul ignore next */ 
      return escapeSequence;
  }
}

function decodeValue(encoded: string, params: ReadParameters): Result<string> {

  switch (params.protocolVersion) {
    case STOMP_VERSION_10:
      return success(encoded);

    case STOMP_VERSION_11:
      return success(encoded.replace(/\\n|\\c|\\\\/g, decodeEscapeSequence));

    case STOMP_VERSION_12:
      return success(encoded.replace(/\\r|\\n|\\c|\\\\/g, decodeEscapeSequence));
  }
}
