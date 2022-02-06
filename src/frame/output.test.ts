import { TextDecoder } from 'util';
import { VoidResult } from '../result';
import { Writer } from '../stream/writer';
import { Chunk, alloc, concatPair } from '../stream/chunk';
import { writeFrame, WriteParameters } from './output';

import {
  STOMP_VERSION_10,
  STOMP_VERSION_11,
  STOMP_VERSION_12,
  Frame
} from './protocol';

import { ok } from '../result';
import { FrameHeaders } from './header';
import { writeEmptyBody } from './body';

const someWriteParams: WriteParameters = {
  bufferSize: 16384,
  protocolVersion: STOMP_VERSION_10
};

class BufferWriter implements Writer {
  private buffer: Chunk;

  public constructor() {
    this.buffer = alloc(0);
  }

  public write(chunk: Chunk): Promise<VoidResult> {
    this.buffer = concatPair(this.buffer, chunk);
    return Promise.resolve(undefined);
  }

  public toString() {
    const decoder = new TextDecoder();
    return decoder.decode(this.buffer);
  }
}

async function writeValid(frame: Frame, params: WriteParameters = someWriteParams) {
  const buffer = new BufferWriter();

  const error = await writeFrame(frame, buffer, params);

  expect(error).toBeUndefined();

  return buffer.toString();
}

async function writeInvalid(frame: Frame, params: WriteParameters = someWriteParams) {
  const buffer = new BufferWriter();

  const error = await writeFrame(frame, buffer, params);

  return error;
}

describe('writeFrame', () => {
  test('typical CONNECT frame', async () => {
    const frame: Frame = {
      command: 'CONNECT',
      headers: new FrameHeaders([
        ['accept-version', '1.2'],
        ['host', '/']
      ]),
      body: writeEmptyBody()
    };

    expect(await writeValid(frame)).toBe('CONNECT\naccept-version:1.2\nhost:\/\n\n\x00\n');
  });

  test('dynamic size', async () => {
    const frame: Frame = {
      command: 'SEND',
      headers: new FrameHeaders([
        ['destination', '/queue/a']
      ]),
      body: (async function* () {
        yield ok(Buffer.from('hel'));
        yield ok(Buffer.from('lo'));
      })()
    };

    expect(await writeValid(frame)).toBe('SEND\ndestination:\/queue\/a\n\nhello\x00\n');
  });

  test('fixed size', async () => {
    const frame: Frame = {
      command: 'SEND',
      headers: new FrameHeaders([
        ['destination', '/queue/a'],
        ['content-length', '5']
      ]),
      body: (async function* () {
        yield ok(Buffer.from('hel'));
        yield ok(Buffer.from('lo'));
      })()
    };

    expect(await writeValid(frame)).toBe('SEND\ndestination:\/queue\/a\ncontent-length:5\n\nhello\x00\n');
  });

  test('bufferless', async () => {
    const frame: Frame = {
      command: 'SEND',
      headers: new FrameHeaders([
        ['destination', '/queue/a']
      ]),
      body: (async function* () {
        yield ok(Buffer.from('hel'));
        yield ok(Buffer.from('lo'));
      })()
    };

    expect(await writeValid(frame, { ...someWriteParams, bufferSize: 0 })).toBe('SEND\ndestination:\/queue\/a\n\nhello\x00\n');
  });

  test('invalid content-length header', async () => {
    const frame: Frame = {
      command: 'SEND',
      headers: new FrameHeaders([
        ['destination', '/queue/a'],
        ['content-length', '-1']
      ]),
      body: (async function* () {
        yield ok(Buffer.from('hel'));
        yield ok(Buffer.from('lo'));
      })()
    };

    const error = await writeInvalid(frame);

    expect(error).toBeDefined();
    expect(error?.message).toBe('invalid content-length header');
  });

  test('incorrect content-length header - declared too small', async () => {
    const frame: Frame = {
      command: 'SEND',
      headers: new FrameHeaders([
        ['destination', '/queue/a'],
        ['content-length', '3']
      ]),
      body: (async function* () {
        yield ok(Buffer.from('hel'));
        yield ok(Buffer.from('lo'));
      })()
    };

    const error = await writeInvalid(frame);

    expect(error).toBeDefined();
    expect(error?.message).toBe('incorrect content-length header');
  });

  test('incorrect content-length header - declared too large', async () => {
    const frame: Frame = {
      command: 'SEND',
      headers: new FrameHeaders([
        ['destination', '/queue/a'],
        ['content-length', '6']
      ]),
      body: (async function* () {
        yield ok(Buffer.from('hel'));
        yield ok(Buffer.from('lo'));
      })()
    };

    const error = await writeInvalid(frame);

    expect(error).toBeDefined();
    expect(error?.message).toBe('incorrect content-length header');
  });

  test('value encoding in protocol version 1.1', async () => {
    const frame: Frame = {
      command: 'SEND',
      headers: new FrameHeaders([
        ['destination', 'queue:a\nqueue:b\nqueue:\\'],
        ['foo:destination', 'test']
      ]),
      body: writeEmptyBody()
    };

    expect(await writeValid(frame, { ...someWriteParams, protocolVersion: STOMP_VERSION_11 }))
      .toBe('SEND\ndestination:queue\\ca\\nqueue\\cb\\nqueue\\c\\\\\nfoo\\cdestination:test\n\n\x00\n')
    ;
  });

  test('value encoding in protocol version 1.2', async () => {
    const frame: Frame = {
      command: 'SEND',
      headers: new FrameHeaders([
        ['destination', 'queue:a\r\nqueue:b\r\nqueue:\\'],
        ['foo:destination', 'test']
      ]),
      body: writeEmptyBody()
    };

    expect(await writeValid(frame, { ...someWriteParams, protocolVersion: STOMP_VERSION_12 }))
      .toBe('SEND\ndestination:queue\\ca\\r\\nqueue\\cb\\r\\nqueue\\c\\\\\nfoo\\cdestination:test\n\n\x00\n')
    ;
  });
});
