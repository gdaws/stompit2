import { TextEncoder, TextDecoder } from 'util';

export type TextEncoding = "ascii" | "utf8" | "utf-8" | "utf16le" | "ucs2" | "ucs-2" | "base64" | "latin1";

export type Chunk = Uint8Array;
export type ChunkStream = AsyncIterator<Chunk>;

const allocImpl = Buffer && Buffer.alloc ? Buffer.alloc : (length: number) => new Uint8Array(length);
const allocUnsafeImpl = Buffer && Buffer.allocUnsafe ? Buffer.allocUnsafe : (length: number) => new Uint8Array(length);

const TextEncoderImpl = TextEncoder;
const TextDecoderImpl = TextDecoder;

export function alloc(length: number): Chunk {
  return allocImpl(length);
}

export function allocUnsafe(length: number): Chunk {
  return allocUnsafeImpl(length);
}

export function concatPair(first: Chunk, second: Chunk): Chunk {

  const result = new Uint8Array(first.length + second.length);

  result.set(first, 0);
  result.set(second, first.length);

  return result;
}

export async function* streamFromString(value: string): ChunkStream {
  const encoder = new TextEncoderImpl();
  yield encoder.encode(value);
}

export function encodeUtf8String(value: string): Chunk {
  const encoder = new TextEncoderImpl();
  return encoder.encode(value);
}

export function decodeString(chunk: Chunk, encoding: TextEncoding = 'utf-8'): string {
  const decoder = new TextDecoderImpl();
  return decoder.decode(chunk);
}
