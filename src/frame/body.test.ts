
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
import { success } from '../result';
import { createSignal } from '../concurrency';

async function read(body: FrameBody): Promise<FrameBodyChunk> {

  let result = alloc(0);

  for await (const chunk of body) {

    if (chunk.error) {
      return chunk;
    }

    result = concatPair(result, chunk.value);
  }

  return success(result);
}

test('writeEmptyBody', async () => {
  const body = writeEmptyBody();
  const status = await body.next();
  expect(status.done).toBe(true);
});

describe('readEmptyBody', () => {

  test('empty body', async () => {
    const result = await readEmptyBody(writeEmptyBody());
    expect(result.error).toBeUndefined();
  });
  
  test('error', async () => {

    const result = await readEmptyBody(writeError(new Error('fail')));

    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe('fail');
  });

  test('non-empty body', async () => {

    const createNonEmptyBody = async function *() {
      yield success(Buffer.alloc(10));
    };

    const result = await readEmptyBody(createNonEmptyBody());

    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe('expected empty body');
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

  const result = await readString(writeString('hello'));

  if (result.error) {
    expect(result.error).toBeUndefined();
    return;
  }

  expect(result.value).toBe('hello');
});

test('readString error', async () => {

  const result = await readString(writeError(new Error('fail')));

  expect(result.error).toBeDefined();
});

test('readString unsupported encoding', async () => {

  const result = await readString(writeString('hello'), 'unsupported' as any);

  expect(result.error).toBeDefined();
});

test('readJson', async () => {

  const result = await readJson(writeString(`{"a": 1, "b": "hello", "c": [1, 2]}`));

  if (result.error) {
    expect(result.error).toBeUndefined();
    return;
  }

  expect(typeof result.value).toBe('object');
  expect(result.value.a).toBe(1);
  expect(result.value.b).toBe('hello');
  expect(Array.isArray(result.value.c)).toBe(true);
});

test('readJson read error', async () => {
  const result = await readJson(writeError(new Error('fail')));
  expect(result.error).toBeDefined();
});

test('readJson decode error', async () => {
  const result = await readJson(writeString(`{{{`));
  expect(result.error).toBeDefined();
});

test('writeJson', async () => {

  const expected = {
    a: 'test',
    b: 1
  };

  const body = writeJson(expected);

  const result = await read(body);
  
  if (result.error) {
    expect(result.error).toBeUndefined();
    return;
  }

  expect(result.value).toBeDefined();

  const actual = JSON.parse(decodeString(result.value));

  expect(actual.a).toBe(expected.a);
  expect(actual.b).toBe(expected.b);
});

test('writeJson error', async () => {

  const writeIterator = writeJson(BigInt(1));

  const writeResult = await writeIterator.next();

  const value = writeResult.value;

  expect(value.error).toBeDefined();
});

test('createEmitEndDecorator', async () => {

  const [signal, emit] = createSignal<Error | void>();

  const body = createEmitEndDecorator(writeString('hello'), emit);

  for await (const chunk of body) {
  }

  const result = await signal;

  const status = await body.next();

  expect(result).toBeUndefined();
  expect(status.done).toBe(true);
});

test('createEmitEndDecorator read error', async () => {

  const [signal, emit] = createSignal<Error | void>();

  const body = createEmitEndDecorator(writeError(new Error('fail')), emit);

  for await (const chunk of body) {
  }

  const error = await signal;

  expect(error).toBeDefined();
});
