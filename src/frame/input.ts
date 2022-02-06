import { Result, ok, fail, failed } from '../result';
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
   * The maximum number of header lines allowed in a frame header.
   */
  maxHeaderLines: number;

  /**
   * The maximum byte length of a header line.
   */
  maxLineLength: number;

  /**
   * The maximum byte length of a frame body.
   *
   * For unlimited size set `Infinity` value.
   */
  maxBodyLength: number;

  /**
   * The maximum byte length of a body chunk read from the transport stream.
   */
  maxBodyChunkLength: number;
}

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
}

/**
 * Deserialise a frame from an input stream.
 *
 * The return value resolves when the header has been deserialised. The caller then reads the body by iterating on the
 * `body` property.
 */
export async function readFrame(reader: Reader, params: ReadParameters): Promise<Result<Frame>> {
  const commandResult = await readCommand(reader, params);

  if (failed(commandResult)) {
    return commandResult;
  }

  const command = commandResult.value;

  const headerLines = [];

  for await (const result of readHeaderLines(reader, params)) {
    if (failed(result)) {
      return result;
    }

    headerLines.push(result.value);
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

  return ok({
    command,
    headers,
    body
  });
}

async function readCommand(reader: Reader, params: ReadParameters): Promise<Result<string>> {
  const result = await reader.readLine(params.maxLineLength);

  if (failed(result)) {
    return result;
  }

  const line = result.value;

  if (line.length === 0) {
    // reading EOL trailer from previous frame
    if (params.ignoreLeadingEmptyLines) {
      return await readCommand(reader, params);
    }
    else {
      return fail(new Error('malformed frame expected command line'));
    }
  }

  return ok(decodeString(line, HEADER_CHAR_ENCODING));
}

async function* readHeaderLines(reader: Reader, params: ReadParameters): AsyncGenerator<Result<HeaderLine>> {
  let count = 0;

  while (count++ <= params.maxHeaderLines) {
    const result = await reader.readLine(params.maxLineLength);

    if (failed(result)) {
      yield result;
      /* istanbul ignore next */
      return;
    }

    const line = result.value;

    if (0 === line.length) {
      return;
    }

    const lineString = decodeString(line, HEADER_CHAR_ENCODING);

    const separator = lineString.indexOf(':');

    if (-1 === separator) {
      yield fail(new Error('header parse error ' + lineString));
      /* istanbul ignore next */
      return;
    }

    const nameDecodeResult = decodeValue(lineString.substring(0, separator), params);
    const valueDecodeResult = decodeValue(lineString.substring(separator + 1), params);

    if (failed(nameDecodeResult) || failed(valueDecodeResult)) {
      yield fail(new Error('header value decode error'));
      /* istanbul ignore next */
      return;
    }

    yield ok([nameDecodeResult.value, valueDecodeResult.value]);
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
    const result = await reader.read(Math.min(remaining, params.maxBodyChunkLength));

    if (failed(result)) {
      yield result;
      /* istanbul ignore next */
      return;
    }

    const chunk = result.value;

    remaining -= chunk.length;

    yield ok(chunk);
  }

  const endResult = await reader.read(1);

  if (failed(endResult)) {
    yield endResult;
    /* istanbul ignore next */
    return;
  }

  const endChunk = endResult.value;

  if (0x0 !== endChunk[0]) {
    yield fail(new Error('expected null byte'));
    /* istanbul ignore next */
    return;
  }

  yield ok(Buffer.alloc(0));
}

async function* readDynamicSizeBody(reader: Reader, params: ReadParameters): AsyncGenerator<Result<Chunk>> {
  let totalSize = 0;

  while (true) {
    const result = await reader.readUntil(0x0, params.maxBodyChunkLength);

    if (failed(result)) {
      yield result;
      /* instanbul ignore next */
      return;
    }

    const chunk = result.value;

    const ended = 0x0 === chunk[chunk.length - 1];

    totalSize += chunk.length + (ended ? -1 : 0);

    if (totalSize > params.maxBodyLength) {
      yield fail(new Error('frame body too large'));
      /* istanbul ignore next */
      return;
    }

    if (ended) {
      yield ok(chunk.slice(0, chunk.length - 1));
      /* istanbul ignore next */
      return;
    }
    else {
      yield ok(chunk);
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
      return ok(encoded);

    case STOMP_VERSION_11:
      return ok(encoded.replace(/\\n|\\c|\\\\/g, decodeEscapeSequence));

    case STOMP_VERSION_12:
      return ok(encoded.replace(/\\r|\\n|\\c|\\\\/g, decodeEscapeSequence));
  }
}
