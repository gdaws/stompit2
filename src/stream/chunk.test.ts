import { alloc, allocUnsafe, concatPair, streamFromString, encodeUtf8String, decodeString } from './chunk';

test('alloc', () => {
  const array = alloc(10);

  expect(array.length).toBe(10);
  expect(array.byteLength).toBe(10);

  expect(array[0]).toBe(0);
});

test('allocUnsafe', () => {
  const array = allocUnsafe(10);

  expect(array.length).toBe(10);
  expect(array.byteLength).toBe(10);
});

test('concatPair', () => {
  const first = alloc(1);
  first[0] = 1;

  const second = alloc(1);
  second[0] = 2;

  const joined = concatPair(first, second);

  expect(joined.length).toBe(2);

  expect(joined[0]).toBe(1);
  expect(joined[1]).toBe(2);
});

test('streamFromString', async () => {
  const stream = streamFromString('A');

  let buffer = alloc(0);

  for await (const chunk of { [Symbol.asyncIterator]: () => stream }) {
    buffer = concatPair(buffer, chunk);
  }

  expect(buffer.length).toBe(1);
  expect(buffer[0]).toBe(65);
});

test('encodeUtf8String', () => {
  const chunk = encodeUtf8String('A');

  expect(chunk.length).toBe(1);
  expect(chunk[0]).toBe(65);
});

test('decodeString', () => {
  const chunk = alloc(1);
  chunk[0] = 65;

  const decoded = decodeString(chunk);

  expect(decoded).toBe('A');
});
