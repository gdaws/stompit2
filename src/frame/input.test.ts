import { TextEncoder } from 'util';
import { Reader } from '../stream/reader';
import { readFrame, ReadParameters } from './input';

import {
  STOMP_VERSION_10,
  STOMP_VERSION_11,
  STOMP_VERSION_12,
  Frame,
  FrameBodyChunk,
  FrameBody,
} from './protocol';

import { ok, failed, result, error, Result } from '../result';
import { decodeString } from '../stream/chunk';

function reader(value: string): Reader {
  return new Reader((async function* () {
    const encoder = new TextEncoder();
    yield encoder.encode(value);
  })());
}

function neverResolve(): Promise<void> {
  return new Promise(() => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
  });
}

async function read(body: FrameBody): Promise<FrameBodyChunk> {
  let buffer = Buffer.alloc(0);

  for await (const result of body) {
    if (failed(result)) {
      return result;
    }

    buffer = Buffer.concat([buffer, result.value]);
  }

  return ok(buffer);
}

async function readToString(body: FrameBody): Promise<string> {
  return decodeString(result(await read(body)));
}

async function expectEmptyBody(frame: Frame) {
  const body = result(await read(frame.body));

  expect(body.length).toBe(0);
}

const someReadParams: ReadParameters = {
  maxHeaderLines: 64,
  maxLineLength: 4096,
  maxBodyLength: Infinity,
  maxBodyChunkLength: 4096,
  ignoreLeadingEmptyLines: true,
  protocolVersion: STOMP_VERSION_10
};

async function parseValid(value: string, params: ReadParameters = someReadParams): Promise<Frame> {
  return result(await readFrame(reader(value), params));
}

describe('readFrame', () => {
  test('empty frame', async () => {
    const frame = await parseValid('EMPTY\n\n\x00');

    expect(frame.command).toBe('EMPTY');
    expect(Array.from(frame.headers)).toHaveLength(0);

    await expectEmptyBody(frame);
  });

  test('CRLF lines', async () => {
    const frame = await parseValid('EMPTY\r\n\r\n\x00');

    expect(frame.command).toBe('EMPTY');
    expect(Array.from(frame.headers)).toHaveLength(0);

    await expectEmptyBody(frame);
  });

  test('repeated header entries', async () => {
    const frame = await parseValid('MESSAGE\nfoo: Hello\nfoo: World\n\n\x00');

    expect(frame.headers.get('foo')).toBe(' Hello');

    const fooHeaders = frame.headers.getAll('foo');

    expect(fooHeaders[0]).toBe(' Hello');
    expect(fooHeaders[1]).toBe(' World');
  });

  test('typical connect frame', async () => {
    const frame = await parseValid('CONNECT\naccept-version:1.2\nhost:stomp.github.org\n\n\x00');

    expect(frame.command).toBe('CONNECT');
    expect(frame.headers.get('accept-version')).toBe('1.2');
    expect(frame.headers.get('host')).toBe('stomp.github.org');

    await expectEmptyBody(frame);
  });

  test('typical send frame', async () => {
    const frame = await parseValid('SEND\ndestination:/queue/a\ncontent-type:text\/plain\n\nhello queue a\n\x00');

    expect(frame.command).toBe('SEND');
    expect(frame.headers.get('destination')).toBe('/queue/a');
    expect(frame.headers.get('content-type')).toBe('text\/plain');

    const body = await readToString(frame.body);

    expect(body).toBe('hello queue a\n');
  });

  test('fixed size body', async () => {
    const frame = await parseValid('SEND\ncontent-length:5\n\nhello\x00');
    const body = await readToString(frame.body);
    expect(body).toBe('hello');
  });

  test('fixed size body error', async () => {
    const frame = result(await readFrame(reader('SEND\ncontent-length:5\n\n.'), someReadParams));

    const bodyIterator = frame.body;

    const bodyResult = (await bodyIterator.next()).value;

    if (!bodyResult) {
      expect(bodyResult).toBeDefined();
      return;
    }

    expect(bodyResult.error).toBeDefined();
  });

  test('dynamic size body read error', async () => {
    const frame = result(await readFrame(reader('SEND\n\n...'), someReadParams));

    const bodyIterator = frame.body;

    const first = (await bodyIterator.next()).value;

    expect(first.error).toBeDefined();
  });

  test('fixed size body error on NULL byte', async () => {
    const frame = result(await readFrame(reader('SEND\ncontent-length:5\n\n.....'), someReadParams));

    const bodyIterator = frame.body;

    const first = (await bodyIterator.next()).value;

    expect(first.error).toBeUndefined();

    const second = (await bodyIterator.next()).value;

    expect(second.error).toBeDefined();
  });

  test('fixed size body error no NULL byte', async () => {
    const frame = result(await readFrame(reader('SEND\ncontent-length:5\n\n.....A'), someReadParams));

    const bodyIterator = frame.body;

    const first = (await bodyIterator.next()).value;

    expect(first.error).toBeUndefined();

    const second = (await bodyIterator.next()).value;

    expect(second.error).toBeDefined();
  });

  test('fixed size body with a null character wihin the body', async () => {
    const frame = await parseValid('SEND\ncontent-length:3\n\n\x00\x01\x02\x00');

    const buffer = result(await read(frame.body));

    expect(buffer.length).toBe(3);

    expect(buffer[0]).toBe(0);
    expect(buffer[1]).toBe(1);
    expect(buffer[2]).toBe(2);
  });

  test('multiple frames', async () => {
    const source = reader('SEND\n\nfirst\x00SEND\n\nsecond\x00\n\nSEND\n\nthird\x00');

    const firstFrame = result(await readFrame(source, someReadParams));

    expect(await readToString(firstFrame.body)).toBe('first');

    const secondFrame = result(await readFrame(source, someReadParams));

    expect(await readToString(secondFrame.body)).toBe('second');

    const thirdFrame = result(await readFrame(source, someReadParams));

    expect(await readToString(thirdFrame.body)).toBe('third');
  });

  test('value decoding in protocol version 1.0', async () => {
    const first = await parseValid('SEND\na:b:\\n\\c\n\n\n\x00', { ...someReadParams, protocolVersion: STOMP_VERSION_10 });

    expect(first.headers.get('a')).toBe('b:\\n\\c');
  });

  test('value decoding in protocol version 1.1', async () => {
    const first = await parseValid('SEND\nfoo:\\n\\n\\c\\\\\n\n\x00', { ...someReadParams, protocolVersion: STOMP_VERSION_11 });

    expect(first.headers.get('foo')).toBe('\n\n:\\');

    const second = await parseValid('SEND\na\\c:b\\n\n\n\x00', { ...someReadParams, protocolVersion: STOMP_VERSION_11 });

    expect(second.headers.get('a:')).toBe('b\n');
  });

  test('value decoding in protocol version 1.2', async () => {
    const first = await parseValid('SEND\nfoo:\r\\r\\n\\c\\\\\n\n\x00', { ...someReadParams, protocolVersion: STOMP_VERSION_12 });

    expect(first.headers.get('foo')).toBe('\r\r\n:\\');
  });

  test('header completion of partial frame', async () => {
    const reader = new Reader((async function* () {
      const encoder = new TextEncoder();
      yield encoder.encode('SEND');
      yield encoder.encode('\ncontent');
      yield encoder.encode('-type:text\/something\n');
      yield encoder.encode('\n');
      await neverResolve();
    })());

    const frame = result(await readFrame(reader, someReadParams));

    expect(frame.command).toBe('SEND');
    expect(frame.headers.get('content-type')).toBe('text\/something');
  });

  test('exceed maxLineLength', async () => {
    const result = await readFrame(reader('CONNECT\n'), { ...someReadParams, maxLineLength: 4 });

    expect(failed(result) && error(result).message).toBe('maximum line length exceeded');
  });

  test('exceed maxLineLength on header line', async () => {
    const result = await readFrame(reader('CONNECT\naweroaiweurapoweiurawerawuera\n'), { ...someReadParams, maxLineLength: 10 });

    expect(failed(result) && error(result).message).toBe('maximum line length exceeded');
  });

  test('exceed maxHeaderLines', async () => {
    const result = await readFrame(reader('CONNECT\nfoo:a\nfoo:b\nfoo:c\n\n\x00'), { ...someReadParams, maxHeaderLines: 2 });

    expect(failed(result) && error(result).message).toBe('maximum header lines exceeded');
  });

  test('exceed maxBodyLength of a dynamic-size body', async () => {
    const frame = await parseValid('SEND\n\nhello\x00', { ...someReadParams, maxBodyLength: 1 });

    const body = await read(frame.body);

    expect(failed(body) && error(body).message).toBe('frame body too large');
  });

  test('exceed maxBodyLength of a fixed-size body', async () => {
    const frame = await parseValid('SEND\ncontent-length:5\n\nhello\x00', { ...someReadParams, maxBodyLength: 1 });

    const body = await read(frame.body);

    expect(failed(body) && error(body).message).toBe('frame body too large');
  });

  test('maxBodyChunkLength of a dyanmic-size body', async () => {
    const frame = await parseValid('SEND\n\nhi\x00', { ...someReadParams, maxBodyChunkLength: 1 });

    const firstIteration = await frame.body.next();

    expect(firstIteration.done).toBe(false);
    expect(firstIteration.value).toBeDefined();

    const chunk1 = result(firstIteration.value as Result<Uint8Array>);

    expect(chunk1.length).toBe(1);
    expect(chunk1[0]).toBe('h'.charCodeAt(0));

    const secondIteration = await frame.body.next();

    expect(secondIteration.done).toBe(false);
    expect(secondIteration.value).toBeDefined();

    const chunk2 = result(secondIteration.value as Result<Uint8Array>);

    expect(chunk2.length).toBe(1);
    expect(chunk2[0]).toBe('i'.charCodeAt(0));

    const thirdIteration = await frame.body.next();

    expect(thirdIteration.done).toBe(false);
    expect(thirdIteration.value).toBeDefined();

    const chunk3 = result(thirdIteration.value as Result<Uint8Array>);

    expect(chunk3.length).toBe(0);

    const fourthIteration = await frame.body.next();

    expect(fourthIteration.done).toBe(true);
    expect(fourthIteration.value).toBeUndefined();
  });

  test('maxBodyChunkLength of a fixed-size body', async () => {
    const frame = await parseValid('SEND\ncontent-length:2\n\nhi\x00', { ...someReadParams, maxBodyChunkLength: 1 });

    const firstIteration = await frame.body.next();

    expect(firstIteration.done).toBe(false);
    expect(firstIteration.value).toBeDefined();

    const chunk1 = result(firstIteration.value as Result<Uint8Array>);

    expect(chunk1.length).toBe(1);
    expect(chunk1[0]).toBe('h'.charCodeAt(0));

    const secondIteration = await frame.body.next();

    expect(secondIteration.done).toBe(false);
    expect(secondIteration.value).toBeDefined();

    const chunk2 = result(secondIteration.value as Result<Uint8Array>);

    expect(chunk2.length).toBe(1);
    expect(chunk2[0]).toBe('i'.charCodeAt(0));

    const thirdIteration = await frame.body.next();

    expect(thirdIteration.done).toBe(false);
    expect(thirdIteration.value).toBeDefined();

    const chunk3 = result(thirdIteration.value as Result<Uint8Array>);

    expect(chunk3.length).toBe(0);

    const fourthIteration = await frame.body.next();

    expect(fourthIteration.done).toBe(true);
    expect(fourthIteration.value).toBeUndefined();
  });

  test('malformed command line', async () => {
    const result = await readFrame(reader('\n'), { ...someReadParams, ignoreLeadingEmptyLines: false });

    expect(failed(result) && error(result).message).toBe('malformed frame expected command line');
  });

  test('malformed header line', async () => {
    const result = await readFrame(reader('CONNECT\ninvalidheader\n'), { ...someReadParams, ignoreLeadingEmptyLines: false });

    expect(failed(result) && error(result).message).toBe('header parse error invalidheader');
  });
});
