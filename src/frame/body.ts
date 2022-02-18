import { TextDecoder } from 'util';
import { ok, fail, failed, error, Result } from '../result';
import { StompitError } from '../error';
import { TextEncoding, encodeUtf8String } from '../stream/chunk';
import { SignalEmitter } from '../concurrency';
import { FrameBody } from './protocol';

/**
 * Returns a FrameBody that yields a fail result. This function is useful in FrameBody write functions where an invalid
 * argument is given and encoding cannot be performed
 *
 * @param error The error object to encapsulate in the fail result
 */
export async function* writeError(error: StompitError): FrameBody {
  yield fail(error);
}

/**
 * Returns an empty frame body
 */
export async function* writeEmptyBody(): FrameBody {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
}

/**
 * Attempt to read the frame body and expect it to be empty. If the frame body is not empty then the reading
 * stops (unfinished) and the function returns a fail result.
 *
 * @param body The frame body
 */
export async function readEmptyBody(body: FrameBody): Promise<Result<undefined, StompitError>> {
  for await (const chunkResult of body) {
    if (failed(chunkResult)) {
      return chunkResult;
    }

    if (chunkResult.value.length > 0) {
      return fail(new StompitError('ProtocolViolation', 'expected empty body'));
    }
  }

  return ok(undefined);
}

export async function* writeBuffer(buffer: Buffer): FrameBody {
  yield ok(buffer);
}

/**
 * Write utf-8 encoded string to frame body
 *
 * @param value
 * @param encoding
 */
export async function* writeString(value: string): FrameBody {
  yield ok(encodeUtf8String(value));
}

/**
 * Read the frame body into a single string
 *
 * @param body The frame body
 * @param encoding The character encoding of the frame body content
 */
export async function readString(body: FrameBody, encoding: TextEncoding = 'utf-8', lengthLimit = Infinity): Promise<Result<string, StompitError>> {
  let decoder;

  try {
    decoder = new TextDecoder(encoding);
  }
  catch (error) {
    return fail(new StompitError('ProtocolViolation', error instanceof Error ? `frame body text decoding failed: ${error.message}` : 'frame body text decoding failed'));
  }

  let result = '';

  for await (const chunkResult of body) {
    if (failed(chunkResult)) {
      return chunkResult;
    }

    try {
      result = result + decoder.decode(chunkResult.value, { stream: true });

      if (result.length > lengthLimit) {
        return fail(new StompitError('ProtocolViolation', `body length limit exceeded (${lengthLimit} bytes)`));
      }
    }
    catch (decodeError) {
      return fail(new StompitError('ProtocolViolation', decodeError instanceof Error ? `frame body text decoding failed: ${decodeError.message}` : 'frame body text decoding failed'));
    }
  }

  try {
    result = result + decoder.decode();
  }
  catch (decodeError) {
    return fail(new StompitError('ProtocolViolation', decodeError instanceof Error ? `frame body text decoding failed: ${decodeError.message}` : 'frame body text decoding failed'));
  }

  return ok(result);
}

/**
 * Returns a FrameBody
 *
 * @param value
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeJson(value: any): FrameBody {
  try {
    return writeString(JSON.stringify(value));
  }
  catch (error) {
    return writeError(new StompitError('ProtocolViolation', error instanceof Error ? `json serialize failed: ${error.message}` : 'json serialization error'));
  }
}

/**
 * Read the frame body into a string and then parse it as JSON
 *
 * @param body The frame body
 * @param encoding The character encoding of the frame body content
 * @return The parsed JSON value
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(body: FrameBody, encoding: TextEncoding = 'utf-8'): Promise<Result<any, StompitError>> {
  const string = await readString(body, encoding);

  if (failed(string)) {
    return string;
  }

  try {
    const value = JSON.parse(string.value);
    return ok(value);
  }
  catch (jsonParseError) {
    return fail(new StompitError('ProtocolViolation', jsonParseError instanceof Error ? `json parse error: ${jsonParseError.message}` : 'json parse error'))
  }
}

/**
 * @hidden
 *
 * Observe when the frame handler has finished reading the body
 */
export async function* createEmitEndDecorator(actual: FrameBody, onEnd: SignalEmitter<Error | void>): FrameBody {
  for await (const chunk of actual) {
    yield chunk;

    if (failed(chunk)) {
      onEnd(error(chunk));
      return;
    }
  }

  onEnd();
}
