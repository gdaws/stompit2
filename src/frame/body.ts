import { success, fail, Result } from '../result';
import { TextEncoding } from '../stream/chunk';
import { Emitter } from '../emitter';
import { FrameBody } from './protocol';
import { TextEncoder, TextDecoder } from 'util';

const stringEncoder = new TextEncoder();

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
  
}

/**
 * Attempt to read the frame body and expect it to be empty. If the frame body is not empty then the reading 
 * stops (unfinished) and the function returns a fail result.
 * 
 * @param body The frame body
 */
export async function readEmptyBody(body: FrameBody): Promise<Result<undefined>> {
  
  for await (const chunkResult of body) {

    if (chunkResult.error) {
      return fail(chunkResult.error);
    }

    if (chunkResult.value.length > 0) {
      return fail(new Error('expected empty body'));
    }
  }

  return success(undefined);
}

export async function* writeBuffer(buffer: Buffer): FrameBody {
  yield success(buffer);
}

/**
 * Write utf-8 encoded string to frame body
 *
 * @param value  
 * @param encoding 
 */
export async function* writeString(value: string): FrameBody {
  const encoder = new TextEncoder();
  yield success(encoder.encode(value));
}

/**
 * Read the frame body into a single string
 * 
 * @param body The frame body
 * @param encoding The character encoding of the frame body content
 */
export async function readString(body: FrameBody, encoding: TextEncoding = 'utf-8'): Promise<Result<string>> {

  const decoder = new TextDecoder(encoding);

  let result = '';

  for await (const chunkResult of body) {
    
    if (chunkResult.error) {
      return fail(chunkResult.error);
    }

    try {
      result = result + decoder.decode(chunkResult.value, { stream: true });
    }
    catch(decodeError) {
      return fail(decodeError);
    }
  }

  try {
    result = result + decoder.decode();
  }
  catch(decodeError) {
    return fail(decodeError);
  }

  return success(result);
}

/**
 * Returns a FrameBody 
 *
 * @param value
 */
export function writeJson(value: any): FrameBody {

  try {
    return writeString(JSON.stringify(value));
  }
  catch(error) {
    return writeError(error);
  }
}

/**
 * Read the frame body into a string and then parse it as JSON
 *  
 * @param body The frame body
 * @param encoding The character encoding of the frame body content
 * @return The parsed JSON value
 */
export async function readJson(body: FrameBody, encoding: TextEncoding = 'utf-8'): Promise<Result<any>> {

  const string = await readString(body, encoding);

  if (string.error) {
    return fail(string.error);
  }

  try {
    const value = JSON.parse(string.value);
    return success(value);
  }
  catch(jsonParseError) {
    return fail(jsonParseError);
  }
}

/**
 * @hidden
 * 
 * Observe when the frame handler has finished reading the body
 */
export async function* createEmitEndDecorator(actual: FrameBody, onEnd: Emitter<Error | void>): FrameBody {

  for await (const chunk of actual) {

    yield chunk;

    if (chunk.error) {
      onEnd(chunk.error);
      return;
    }
  }

  onEnd();
}
