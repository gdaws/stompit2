
import {
  writeEmptyBody,
  readEmptyBody,
  writeString,
  readString,
  writeJson,
  readJson,
  createEmitEndDecorator,
  writeError,
  writeBuffer
} from './body';

import { FrameBody, FrameBodyChunk } from './protocol';
import { Chunk, alloc, concatPair, decodeString } from '../stream/chunk';
import { ok, failed, result, error } from '../result';
import { createSignal } from '../concurrency';

async function read(body: FrameBody): Promise<FrameBodyChunk> {
  let result = alloc(0);

  for await (const chunk of body) {
    if (failed(chunk)) {
      return chunk;
    }

    result = concatPair(result, chunk.value);
  }

  return ok(result);
}

test('writeEmptyBody', async () => {
  const body = writeEmptyBody();
  const status = await body.next();
  expect(status.done).toBe(true);
});

describe('readEmptyBody', () => {
  test('empty body', async () => {
    result(await readEmptyBody(writeEmptyBody()));
  });

  test('error', async () => {
    const result = await readEmptyBody(writeError(new Error('fail test')));
    expect(failed(result) && error(result).message).toBe('fail test');
  });

  test('non-empty body', async () => {
    const createNonEmptyBody = async function* () {
      yield ok(Buffer.alloc(10));
    };

    const result = await readEmptyBody(createNonEmptyBody());

    expect(failed(result) && error(result).message).toBe('expected empty body');
  });
});

test('writeError', async () => {
  const writeIterator = writeError(new Error('test'));

  const writeResult = await writeIterator.next();

  const value = writeResult.value;

  expect(value.error).toBeDefined();
});

test('writeBuffer', async () => {
  const writeIterator = writeBuffer(Buffer.from('A'));

  const writeResult = await writeIterator.next();

  const value = writeResult.value;

  expect(value.error).toBeUndefined();

  const buffer = value.value;

  expect(buffer.byteLength).toBe(1);
  expect(buffer[0]).toBe(65);
});

test('writeString', async () => {
  const body = writeString('hello');

  const first = await body.next();

  expect(first.done).toBe(false);
  expect(first.value.error).toBeUndefined();

  const chunk: Chunk = first.value.value;

  expect(chunk[0]).toBe('h'.charCodeAt(0));
  expect(chunk[1]).toBe('e'.charCodeAt(0));
  expect(chunk[2]).toBe('l'.charCodeAt(0));
  expect(chunk[3]).toBe('l'.charCodeAt(0));
  expect(chunk[4]).toBe('o'.charCodeAt(0));

  const second = await body.next();

  expect(second.done).toBe(true);
});

test('readString', async () => {
  const value = result(await readString(writeString('hello')));

  expect(value).toBe('hello');
});

test('readString error', async () => {
  const result = await readString(writeError(new Error('fail')));

  expect(failed(result) && error(result).message).toBe('fail');
});

test('readString unsupported encoding', async () => {
  const result = await readString(writeString('hello'), 'unsupported' as any);

  expect(failed(result)).toBe(true);
});

test('readJson', async () => {
  const value = result(await readJson(writeString('{"a": 1, "b": "hello", "c": [1, 2]}')));

  expect(typeof value).toBe('object');
  expect(value.a).toBe(1);
  expect(value.b).toBe('hello');
  expect(Array.isArray(value.c)).toBe(true);
});

test('readJson read error', async () => {
  const result = await readJson(writeError(new Error('fail')));
  expect(failed(result) && error(result).message).toBe('fail');
});

test('readJson decode error', async () => {
  const result = await readJson(writeString('{{{'));
  expect(failed(result)).toBe(true);
});

test('writeJson', async () => {
  const expected = {
    a: 'test',
    b: 1
  };

  const body = writeJson(expected);

  const string = result(await read(body));

  const actual = JSON.parse(decodeString(string));

  expect(actual.a).toBe(expected.a);
  expect(actual.b).toBe(expected.b);
});

test('writeJson error', async () => {
  const writeIterator = writeJson(BigInt(1));

  const result = await writeIterator.next();

  expect(failed(result.value)).toBe(true);
});

test('createEmitEndDecorator', async () => {
  const [signal, emit] = createSignal<Error | void>();

  const body = createEmitEndDecorator(writeString('hello'), emit);

  for await (const _chunk of body) { }

  const result = await signal;

  const status = await body.next();

  expect(result).toBeUndefined();
  expect(status.done).toBe(true);
});

test('createEmitEndDecorator read error', async () => {
  const [signal, emit] = createSignal<Error | void>();

  const body = createEmitEndDecorator(writeError(new Error('fail')), emit);

  for await (const _chunk of body) { }

  const error = await signal;

  expect(error).toBeDefined();
});
