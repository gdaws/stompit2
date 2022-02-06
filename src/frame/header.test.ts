
import { FrameHeaders } from './header';

let headers: FrameHeaders;

beforeEach(() => {
  headers = new FrameHeaders([
    ['Content-Type', 'text/plain'],
    ['X-Foo', 'First'],
    ['X-Foo', 'Second'],
    ['X-Empty', '']
  ]);
});

test('iterator', () => {
  const iter = headers[Symbol.iterator]();

  const first = iter.next();

  expect(first.value[0]).toBe('content-type');
  expect(first.value[1]).toBe('text/plain');

  const second = iter.next();

  expect(second.value[0]).toBe('x-foo');
  expect(second.value[1]).toBe('First');

  const third = iter.next();

  expect(third.value[0]).toBe('x-foo');
  expect(third.value[1]).toBe('Second');
});

test('get', () => {
  expect(headers.get('X-FOO')).toBe('First');
  expect(headers.get('Content-type')).toBe('text/plain');
});

test('getAll', () => {
  const values = headers.getAll('X-foo');

  expect(values.length).toBe(2);

  expect(values[0]).toBe('First');
  expect(values[1]).toBe('Second');
});

test('has', () => {
  expect(headers.has('x-empty')).toBe(false);
  expect(headers.has('content-type')).toBe(true);
});

test('fromEntries', () => {
  const headers = FrameHeaders.fromEntries([
    ['Content-Length', '0'],
    ['Content-Type', 'text/html']
  ]);

  expect(headers.get('Content-Length')).toBe('0');
  expect(headers.get('Content-Type')).toBe('text/html');
});

test('fromMap', () => {
  const headers = FrameHeaders.fromMap({
    'Content-Length': '0',
    'Content-Type': 'text/html'
  });

  expect(headers.get('Content-Length')).toBe('0');
  expect(headers.get('Content-Type')).toBe('text/html');
});

test('concat', () => {
  const headers = FrameHeaders.concat(
    FrameHeaders.fromMap({
      'Content-Type': 'first',
      'X-Foo': 'first'
    }),
    FrameHeaders.fromMap({
      'Content-Type': 'second',
      'X-Foo': 'second'
    })
  );

  expect(headers.get('Content-Type')).toBe('first');

  const lines = headers.getAll('Content-Type');

  expect(lines).toHaveLength(2);

  expect(lines[0]).toBe('first');
  expect(lines[1]).toBe('second');
});

test('merge', () => {
  const headers = FrameHeaders.merge(
    FrameHeaders.fromMap({
      'Content-Type': 'first',
      'X-Foo': 'first'
    }),
    FrameHeaders.fromMap({
      'Content-Type': 'second'
    })
  );

  expect(headers.get('Content-Type')).toBe('second');
  expect(headers.get('X-Foo')).toBe('first');

  const lines = headers.getAll('Content-Type');

  expect(lines).toHaveLength(1);

  expect(lines[0]).toBe('second');
});
