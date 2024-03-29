import { Result, ok, failed, result } from '../result';
import { StompitError } from '../error';
import { Transport } from '../transport';
import { Frame, STOMP_VERSION_10 } from '../frame/protocol';
import { FrameHeaders } from '../frame/header';
import { writeEmptyBody, readEmptyBody, writeString } from '../frame/body';
import { RECEIPT_NOT_REQUESTED } from './receipt';
import { connect } from './connect';

class Server implements Transport {
  public writeResult: StompitError | undefined;
  public readResult: Result<Frame>;
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  public calls: [keyof Server, any[]][];

  public constructor(writeResult: StompitError | undefined, readResult: Result<Frame>) {
    this.writeResult = writeResult;
    this.readResult = readResult;
    this.calls = [];
  }

  public static connected(headers: FrameHeaders) {
    return new Server(undefined, ok({
      command: 'CONNECTED',
      headers,
      body: writeEmptyBody()
    }));
  }

  public static error(headers: FrameHeaders, body: string) {
    return new Server(undefined, ok({
      command: 'ERROR',
      headers,
      body: writeString(body)
    }))
  }

  public getReceiptTimeout() {
    // eslint-disable-next-line prefer-rest-params
    this.calls.push(['getReceiptTimeout', [...arguments]]);
    return RECEIPT_NOT_REQUESTED;
  }

  public readFrame(): Promise<Result<Frame>> {
    // eslint-disable-next-line prefer-rest-params
    this.calls.push(['readFrame', [...arguments]]);
    return Promise.resolve(this.readResult);
  }

  public writeFrame(): Promise<StompitError | undefined> {
    // eslint-disable-next-line prefer-rest-params
    this.calls.push(['writeFrame', [...arguments]]);
    return Promise.resolve(this.writeResult);
  }

  public close() {
    // eslint-disable-next-line prefer-rest-params
    this.calls.push(['close', [...arguments]]);
    return Promise.resolve();
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

  const session = result(await connect(server, headers));

  expect(server.calls.length).toBe(2);

  expect(server.calls[0][0]).toBe('writeFrame');

  const connectFrame: Frame = server.calls[0][1][0];

  expect(connectFrame.command).toBe('CONNECT');

  expect(connectFrame.headers.get('accept-version')).toBe('1.0,1.1,1.2');
  expect(connectFrame.headers.get('login')).toBe(headers.get('login'));
  expect(connectFrame.headers.get('passcode')).toBe(headers.get('passcode'));
  expect(connectFrame.headers.has('heart-beat')).toBe(false);

  result(await readEmptyBody(connectFrame.body));

  expect(server.calls[0][1][1]).toBe(STOMP_VERSION_10);

  expect(server.calls[1][0]).toBe('readFrame');

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

  expect(failed(result)).toBe(true);
});
