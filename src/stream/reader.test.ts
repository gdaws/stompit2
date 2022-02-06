import { failed, result, error } from '../result';
import { ChunkStream, streamFromString, decodeString } from './chunk';
import { Reader, ReadResult } from './reader';

let stream: ChunkStream;
let reader: Reader;

beforeEach(() => {
  stream = streamFromString('');
  reader = new Reader(stream);
});

function reset(value: string) {
  stream = streamFromString(value);
  reader = new Reader(stream);
}

function expectReadEquals(actual: ReadResult, expected: string) {
  expect(decodeString(result(actual))).toBe(expected);
}

function expectReadSubstring(actual: ReadResult, minLength: number, expected: string) {
  const value = decodeString(result(actual));

  expect(value.length).toBeGreaterThanOrEqual(minLength);
  expect(value.length).toBeLessThanOrEqual(expected.length);

  expect(value.indexOf(expected)).toBe(0);
}

function expectReadError(actual: ReadResult, message?: string) {
  if (!failed(actual)) {
    expect(true).toBe(false);
    return;
  }

  if (message) {
    expect(error(actual).message).toBe(message);
  }
}

describe('read', () => {
  test('should not over-consume and should not skip', async () => {
    reset('abcdefh');
    const data1 = await reader.read(3);
    expectReadEquals(data1, 'abc');
    const data2 = await reader.read(3);
    expectReadEquals(data2, 'def');
  });

  test('reject zero bytes request', async () => {
    reset('abcdef');
    const result = await reader.read(0);
    expectReadError(result);
  });

  test('return error result for reading after EOF', async () => {
    reset('');
    const result = await reader.read(1);
    expectReadError(result);
  });

  test('fail concurrent operation', async () => {
    reset('abcdefh');

    const first = reader.read(1);
    const second = reader.read(1);

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expectReadEquals(firstResult, 'a');
    expectReadError(secondResult, 'read operation already running');
  });
});

describe('readRange', () => {
  test('should not over-consume and should not skip', async () => {
    reset('abcdefghij');
    const data1 = await reader.readRange(3, 5);
    expectReadSubstring(data1, 3, 'abcde');
    const data2 = await reader.readRange(5, 5);
    expectReadSubstring(data2, 5, 'fghij');
  });
});

describe('readLine', () => {
  test('should not over-consume and should skip LF characters', async () => {
    reset('line 1\nline 2\n');
    const data1 = await reader.readLine(Infinity);
    expectReadEquals(data1, 'line 1');
    const data2 = await reader.readLine(Infinity);
    expectReadEquals(data2, 'line 2');
  });

  test('should skip CRLF characters', async () => {
    reset('line 1\r\nline 2\r\n');
    const data1 = await reader.readLine(Infinity);
    expectReadEquals(data1, 'line 1');
    const data2 = await reader.readLine(Infinity);
    expectReadEquals(data2, 'line 2');
  });

  test('return error result for reading after EOF', async () => {
    reset('abcdef');
    const result = await reader.readLine(Infinity);
    expectReadError(result);
  });

  test('reject line too long', async () => {
    reset('line 1\nline 2');
    const result = await reader.readLine(2);
    expectReadError(result);
  });
});
