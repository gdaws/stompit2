import { TextDecoder } from 'util';
import { ok, fail, failed, error, Result } from '../result';
import { TextEncoding, encodeUtf8String } from '../stream/chunk';
import { SignalEmitter } from '../concurrency';
import { FrameBody } from './protocol';

/**
 * Returns a FrameBody that yields a fail result. This function is useful in FrameBody write functions where an invalid
 * argument is given and encoding cannot be performed
 *
 * @param error The error object to encapsulate in the fail result
 */
export async function* writeError(error: Error): FrameBody {
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
export async function readEmptyBody(body: FrameBody): Promise<Result<undefined>> {
  for await (const chunkResult of body) {
    if (failed(chunkResult)) {
      return chunkResult;
    }

    if (chunkResult.value.length > 0) {
      return fail(new Error('expected empty body'));
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
export async function readString(body: FrameBody, encoding: TextEncoding = 'utf-8'): Promise<Result<string>> {
  let decoder;

  try {
    decoder = new TextDecoder(encoding);
  }
  catch (error) {
    if (error instanceof Error) {
      return fail(error);
    }
    else {
      return fail(new Error('TextDecoder object instantiation error'));
    }
  }

  let result = '';

  for await (const chunkResult of body) {
    if (failed(chunkResult)) {
      return chunkResult;
    }

    try {
      result = result + decoder.decode(chunkResult.value, { stream: true });
    }
    catch (decodeError) {
      if (decodeError instanceof Error) {
        return fail(decodeError);
      }
      else {
        return fail(new Error('text decode error'));
      }
    }
  }

  try {
    result = result + decoder.decode();
  }
  catch (decodeError) {
    if (decodeError instanceof Error) {
      return fail(decodeError);
    }
    else {
      return fail(new Error('text decode error'));
    }
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
    if (error instanceof Error) {
      return writeError(error);
    }
    else {
      return writeError(new Error('json serialize error'));
    }
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
export async function readJson(body: FrameBody, encoding: TextEncoding = 'utf-8'): Promise<Result<any>> {
  const string = await readString(body, encoding);

  if (failed(string)) {
    return string;
  }

  try {
    const value = JSON.parse(string.value);
    return ok(value);
  }
  catch (jsonParseError) {
    if (jsonParseError instanceof Error) {
      return fail(jsonParseError);
    }
    else {
      return fail(new Error('json parse error'));
    }
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
