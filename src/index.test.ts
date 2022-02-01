import { Result, failed, result, ok } from './result';
import { Frame, ProtocolVersion, STOMP_VERSION_10, acceptedVersions } from './frame/protocol';
import { FrameHeaders } from './frame/header';
import { writeEmptyBody } from './frame/body';
import { RECEIPT_NOT_REQUESTED } from './client/receipt';
import { ClientSession } from './client/session';
import { Transport } from './transport';
import { stompConnect } from './index';

class MockTransport implements Transport {

  public writtenFrame: [Frame, ProtocolVersion] | undefined;
  public closed: boolean;

  public constructor(){
    this.closed = false;
  }

  getReceiptTimeout(frame: Frame) {
    return RECEIPT_NOT_REQUESTED;
  }

  readFrame(protocolVersion: ProtocolVersion): Promise<Result<Frame>> {

    return Promise.resolve(ok({
      command: 'CONNECTED',
      headers: FrameHeaders.fromEntries([
        ['version', '1.2']
      ]),
      body: writeEmptyBody()
    }));
  }

  writeFrame(frame: Frame, protocolVersion: ProtocolVersion): Promise<Error | undefined> {
    this.writtenFrame = [frame, protocolVersion];
    return Promise.resolve(undefined);
  }

  close() {
    this.closed = true;
    return Promise.resolve(undefined);
  }
};

test('stompConnect', async () => {

  const transport = new MockTransport();

  const session = result(await stompConnect(Promise.resolve(ok(transport)), '/', 'guest', 'password'));

  expect(session).toBeInstanceOf(ClientSession);
  expect(session.getProtocolVersion()).toBe('1.2');

  expect(transport.closed).toBe(false);
  
  if (!transport.writtenFrame) {
    expect(transport.writtenFrame).toBeDefined();
    return;
  }

  const [connectFrame, connectFrameProtocol] = transport.writtenFrame;

  expect(connectFrameProtocol).toBe(STOMP_VERSION_10);
  expect(connectFrame.command).toBe('CONNECT');
  expect(connectFrame.headers.get('accept-version')).toBe(acceptedVersions().join(','));
  expect(connectFrame.headers.get('host')).toBe('/');
  expect(connectFrame.headers.get('login')).toBe('guest');
  expect(connectFrame.headers.get('passcode')).toBe('password');
});
