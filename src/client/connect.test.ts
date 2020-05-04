import { Result, success } from '../result';
import { Transport } from '../transport';
import { Frame, ProtocolVersion, STOMP_VERSION_10 } from '../frame/protocol';
import { FrameHeaders } from '../frame/header';
import { writeEmptyBody, readEmptyBody, writeString } from '../frame/body';
import { RECEIPT_NOT_REQUESTED } from './receipt';
import { connect } from './connect';

class Server implements Transport {

  public writeResult: Error | undefined;
  public readResult: Result<Frame>;
  public calls: [keyof Server, any[]][];

  public constructor(writeResult: Error | undefined, readResult: Result<Frame>) {
    this.writeResult = writeResult;
    this.readResult = readResult;
    this.calls = [];
  }

  public static connected(headers: FrameHeaders) {  
    return new Server(undefined, success({
      command: 'CONNECTED',
      headers,
      body: writeEmptyBody()
    }));
  }

  public static error(headers: FrameHeaders, body: string) {
    return new Server(undefined, success({
      command: 'ERROR',
      headers,
      body: writeString(body)
    }))
  }

  public getReceiptTimeout(frame: Frame) {
    this.calls.push(['getReceiptTimeout', [...arguments]]);
    return RECEIPT_NOT_REQUESTED;
  }

  public readFrame(protocolVersion: ProtocolVersion): Promise<Result<Frame>> {
    this.calls.push(['readFrame', [...arguments]]);
    return Promise.resolve(this.readResult);
  }

  public writeFrame(frame: Frame, protocolVersion: ProtocolVersion): Promise<Error | undefined> {
    this.calls.push(['writeFrame', [...arguments]]);
    return Promise.resolve(this.writeResult);
  }

  public close() {
    this.calls.push(['close', [...arguments]]);
  }
}

test('connected response', async () => {

  const headers = FrameHeaders.fromMap({
    'login': 'guest',
    'passcode': 'passcode',
    'heart-beat': '1000,2000'
  });

  const server = Server.connected(FrameHeaders.fromMap({
    'version': '1.2',
    'heart-beat': '2000,2000',
    'session': '123456'
  }));

  const result = await connect(server, headers);

  expect(server.calls.length).toBe(2);

  expect(server.calls[0][0]).toBe('writeFrame');

  const connectFrame: Frame = server.calls[0][1][0];

  expect(connectFrame.command).toBe('CONNECT');

  expect(connectFrame.headers.get('accept-version')).toBe('1.0,1.1,1.2');
  expect(connectFrame.headers.get('login')).toBe(headers.get('login'));
  expect(connectFrame.headers.get('passcode')).toBe(headers.get('passcode'));
  expect(connectFrame.headers.has('heart-beat')).toBe(false);

  const readBody = await readEmptyBody(connectFrame.body);

  expect(readBody.error).toBeUndefined();

  expect(server.calls[0][1][1]).toBe(STOMP_VERSION_10);

  expect(server.calls[1][0]).toBe('readFrame');

  if (result.error) {
    expect(result.error).toBeUndefined();
    return;
  }

  expect(result.value).toBeDefined();

  const session = result.value;

  if (!session) {
    return;
  }

  expect(session.isDisconnected()).toBe(false);
  expect(session.getProtocolVersion()).toBe('1.2');
});

test('error response', async () => {

  const headers = FrameHeaders.fromMap({
    'login': 'guest',
    'passcode': 'passcode',
    'heart-beat': '1000,2000'
  });

  const server = Server.error(FrameHeaders.fromMap({
    'version': '1.2',
    'content-type': 'text/plain'
  }), 'Authentication failed');

  const result = await connect(server, headers);

  if (result.error) {
    expect(result.error).toBeDefined();
    return;
  }

  expect(result.value).toBeUndefined();
});
