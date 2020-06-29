import { Chunk, alloc, concatPair, decodeString, encodeUtf8String } from './stream/chunk';
import { TransportStream, StandardTransport, limitDefaults } from './transport';
import { STOMP_VERSION_10, STOMP_VERSION_12 } from './frame/protocol';
import { FrameHeaders } from './frame/header';
import { writeEmptyBody, readEmptyBody } from './frame/body';
import { Queue, createQueue } from './queue';

class MockTransportStream implements TransportStream {

  public bytesRead: number;

  public bytesWritten: number;

  public read: Queue<Chunk>;
  public written: Chunk;

  public readEnded: boolean;
  public writeEnded: boolean;

  public closed: boolean;

  public constructor() {

    this.bytesRead = 0;
    this.bytesWritten = 0;

    this.read = createQueue<Chunk>();
    this.written = alloc(0);

    this.readEnded = false;
    this.writeEnded = false;

    this.closed = false;
  }

  async * [Symbol.asyncIterator]() {

    for await (const chunk of this.read[1]) {
      this.bytesRead += chunk.byteLength;
      yield chunk;
    }

    this.readEnded = true;
  }

  clearWritten() {
    this.written = alloc(0);
  }

  write(chunk: Chunk) {

    if (this.writeEnded || this.closed) {
      throw new Error('cannot write to stream after writeEnd or close called');
    }

    this.written = concatPair(this.written, chunk);

    this.bytesWritten += chunk.byteLength;

    return Promise.resolve(undefined);
  }

  writeEnd() {
    this.writeEnded = true;
    return Promise.resolve(undefined);
  }

  close() {
    this.closed = true;
    this.read[0].terminate();
  }
};

test('frame serialisation', async () => {

  const stream = new MockTransportStream();

  const client = new StandardTransport(stream, limitDefaults);
  
  const writeError = await client.writeFrame({
    command: 'CONNECT', 
    headers: new FrameHeaders([
      ['accept-version', '1.2']
    ]),
    body: writeEmptyBody()
  }, STOMP_VERSION_10);

  expect(writeError).toBeUndefined();

  expect(decodeString(stream.written)).toBe(`CONNECT\naccept-version:1.2\nheart-beat:${limitDefaults.desiredWriteRate},${limitDefaults.desiredReadRate}\n\n\x00\n`);

  stream.read[0].push(encodeUtf8String('CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\x00\n'));

  const frameResult = await client.readFrame(STOMP_VERSION_10);

  if (frameResult.cancelled) {
    expect(frameResult.cancelled).toBe(false);
    return;
  }

  if (frameResult.error) {
    expect(frameResult.error).toBeUndefined();
    return;
  }

  const connectedFrame = frameResult.value;

  expect(connectedFrame.command).toBe('CONNECTED');
  expect(connectedFrame.headers.get('version')).toBe('1.2');
  expect(connectedFrame.headers.get('heart-beat')).toBe('0,0');

  const readBody = await readEmptyBody(connectedFrame.body);

  if (readBody.cancelled) {
    expect(readBody.cancelled).toBe(false);
    return;
  }

  expect(readBody.error).toBeUndefined();
});

test('heartbeat send', async () => {

  jest.useFakeTimers();

  const clientLimits = {
    ...limitDefaults,
    desiredReadRate: 0,
    desiredWriteRate: 5,
    delayTolerance: 5
  };

  const stream = new MockTransportStream();

  const client = new StandardTransport(stream, clientLimits);

  await client.writeFrame({
    command: 'CONNECT', 
    headers: new FrameHeaders([
      ['accept-version', '1.2']
    ]),
    body: writeEmptyBody()
  }, STOMP_VERSION_10);

  stream.read[0].push(encodeUtf8String('CONNECTED\nversion:1.2\nheart-beat:0,5\n\n\x00\n'));

  await client.readFrame(STOMP_VERSION_10);

  const start = stream.bytesWritten;

  jest.advanceTimersByTime(5);

  expect(stream.bytesWritten).toBe(start + 1);

  jest.advanceTimersByTime(5);

  expect(stream.bytesWritten).toBe(start + 2);
});

test('heartbeat receive', async () => {

  jest.useFakeTimers();

  const clientLimits = {
    ...limitDefaults,
    desiredReadRate: 5,
    desiredWriteRate: 0,
    delayTolerance: 5
  };

  const stream = new MockTransportStream();

  const client = new StandardTransport(stream, clientLimits);

  stream.read[0].push(encodeUtf8String('CONNECTED\nversion:1.2\nheart-beat:5,0\n\n\x00\n'));

  const readConnected = await client.readFrame(STOMP_VERSION_10);

  if (readConnected.cancelled) {
    expect(readConnected.cancelled).toBe(false);
    return;
  }

  if (readConnected.error) {
    expect(readConnected.error).toBeUndefined();
    return;
  }

  await readEmptyBody(readConnected.value.body);

  let bytesReadOnConnected = stream.bytesRead;

  const readMessage = client.readFrame(STOMP_VERSION_12);

  const LF = alloc(1);
  LF[0] = 10;

  stream.read[0].push(LF);

  jest.advanceTimersByTime(10);

  stream.read[0].push(LF);

  jest.advanceTimersByTime(10);

  const message = encodeUtf8String('MESSAGE\nsubscription:0\nmessage-id:1\ndestination:2\n\ntest\x00\n');

  stream.read[0].push(message);

  jest.advanceTimersByTime(10);

  const messageResult = await readMessage;

  if (messageResult.cancelled) {
    expect(messageResult.cancelled).toBe(false);
    return;
  }

  if (messageResult.error) {
    expect(messageResult.error).toBeUndefined();
    return;
  }

  expect(stream.bytesRead).toBe(bytesReadOnConnected + 2 + message.byteLength)
});

test('session timeout', async () => {

  jest.useFakeTimers();

  const clientLimits = {
    ...limitDefaults,
    desiredReadRate: 5,
    desiredWriteRate: 0,
    delayTolerance: 5
  };

  const stream = new MockTransportStream();

  const client = new StandardTransport(stream, clientLimits);

  stream.read[0].push(encodeUtf8String('CONNECTED\nversion:1.2\nheart-beat:5,0\n\n\x00\n'));

  const readConnected = await client.readFrame(STOMP_VERSION_10);

  if (readConnected.cancelled) {
    expect(readConnected.cancelled).toBe(false);
    return;
  }

  if (readConnected.error) {
    expect(readConnected.error).toBeUndefined();
    return;
  }

  await readEmptyBody(readConnected.value.body);

  let bytesReadOnConnected = stream.bytesRead;

  const readMessage = client.readFrame(STOMP_VERSION_12);

  jest.advanceTimersByTime(10);

  const messageResult = await readMessage;

  expect(messageResult.error).toBeDefined();

  if (messageResult.error) {
    expect(messageResult.error.message).toBe('session timeout');
  }

  expect(stream.closed).toBe(true);
});

test('close', async () => {

  const stream = new MockTransportStream();

  const client = new StandardTransport(stream, limitDefaults);

  await client.close();

  expect(stream.closed).toBe(true);

  const readResult = await client.readFrame(STOMP_VERSION_10);

  if (readResult.cancelled) {
    expect(readResult.cancelled).toBe(false);
    return;
  }

  expect(readResult.error).toBeDefined();
  expect(readResult.error?.message).toBe('session closed');

  const writeError = await client.writeFrame({
    command: 'CONNECT', 
    headers: new FrameHeaders([
      ['accept-version', '1.2']
    ]),
    body: writeEmptyBody()
  }, STOMP_VERSION_10);

  expect(writeError).toBeDefined();
  expect(writeError?.message).toBe('session closed');
});
