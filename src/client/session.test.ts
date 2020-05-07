import { Result, success, fail } from '../result';
import { Frame, ProtocolVersion, STOMP_VERSION_12 } from '../frame/protocol';
import { FrameHeaders, HeaderLineOptional } from '../frame/header';
import { writeEmptyBody, writeString, readString } from '../frame/body';
import { Transport } from '../transport';
import { RECEIPT_NOT_REQUESTED, RECEIPT_DEFAULT_TIMEOUT } from './receipt';
import { ClientSession } from './session';

const RECEIPT_SHORT_TIMEOUT = 5;

function receipt(id: string): Frame {
  return {
    command: 'RECEIPT',
    headers: new FrameHeaders([['receipt-id', id]]),
    body: writeEmptyBody()
  };
}

function message(headers: HeaderLineOptional[], body: string) {
  return {
    command: 'SEND',
    headers: new FrameHeaders(headers),
    body: writeString(body)
  };
};

class MockServer implements Transport {

  private receiptTimeout: number;

  private resultQueue: Result<Frame>[];
  private consumerQueue: ((result: Result<Frame>) => void)[];

  private writeFrameResult: Promise<Error | undefined>;

  public calls: [keyof MockServer, any[]][];

  public constructor(outputFrames: Frame[], receiptTimeout: number) {
    this.receiptTimeout = receiptTimeout;
    this.resultQueue = outputFrames.map(frame => success(frame));
    this.consumerQueue = [];
    this.writeFrameResult = Promise.resolve(undefined);;
    this.calls = [];
  }

  public getReceiptTimeout(frame: Frame) {
    this.calls.push(['getReceiptTimeout', [...arguments]]);
    return this.receiptTimeout;
  }

  public readFrame(protocolVersion: ProtocolVersion): Promise<Result<Frame>> {
    
    this.calls.push(['readFrame', [...arguments]]);

    return new Promise((resolve) => {

      if (this.resultQueue.length > 0) {
        resolve(this.resultQueue.shift());
        return;
      }

      this.consumerQueue.push(resolve);
    });
  }

  push(result: Result<Frame>) {

    this.resultQueue.push(result);

    while(this.consumerQueue.length > 0 && this.resultQueue.length > 0) {

      const head = this.resultQueue.shift();
      const consumer = this.consumerQueue.shift();

      if (consumer && head) {
        consumer(head);
      }
    }
  }

  public setWriteFrameResult(result: Promise<Error | undefined>) {
    this.writeFrameResult = result;
  }

  public writeFrame(frame: Frame, protocolVersion: ProtocolVersion): Promise<Error | undefined> {
    this.calls.push(['writeFrame', [...arguments]]);
    return this.writeFrameResult;
  }

  public close() {
    this.calls.push(['close', [...arguments]]);
  }
}

test('send', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);

  const session = new ClientSession(server, STOMP_VERSION_12);

  const originalFrame = {
    command: 'SEND',
    headers: new FrameHeaders([
      ['destination', '/queue/a'],
      ['content-type', 'text/plain']
    ]),
    body: writeString('hello')
  };

  const sendError = await session.send(originalFrame);

  expect(sendError).toBeUndefined();

  expect(server.calls[0][0] == 'getReceiptTimeout');
  
  expect(server.calls[1][0] == 'writeFrame');

  const frame: Frame = server.calls[0][1][0];

  expect(frame.command).toBe('SEND');
  expect(frame.headers.get('destination')).toBe('/queue/a');
  expect(frame.headers.get('content-type')).toBe('text/plain');

  const body = await readString(frame.body);

  if (body.error) {
    expect(body.error).toBeUndefined();
    return;
  }

  expect(body.value).toBe('hello');
});

test('missing destination header', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const originalFrame = {
    command: 'SEND',
    headers: new FrameHeaders([]),
    body: writeString('hello')
  };

  const sendError = await session.send(originalFrame);

  expect(sendError).toBeDefined();
  expect(sendError?.message).toBe('missing destination header');
});

test('receipt', async () => {

  const server = new MockServer([receipt('1')], RECEIPT_SHORT_TIMEOUT);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const originalFrame = {
    command: 'SEND',
    headers: new FrameHeaders([
      ['destination', '/queue/a'],
      ['content-type', 'text/plain']
    ]),
    body: writeString('a')
  };

  const sendError = await session.send(originalFrame);

  expect(sendError).toBeUndefined();

  expect(server.calls.length).toBe(3);

  expect(server.calls[0][0]).toBe('getReceiptTimeout');
  
  // Should expect the client to call readFrame first for the receipt
  expect(server.calls[1][0]).toBe('readFrame');

  expect(server.calls[2][0]).toBe('writeFrame');

  const frame: Frame = server.calls[2][1][0];

  expect(frame.headers.get('receipt')).toBe('1');
});

test('receipt timeout', async () => {

  const server = new MockServer([], RECEIPT_SHORT_TIMEOUT);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const originalFrame = {
    command: 'SEND',
    headers: new FrameHeaders([
      ['destination', '/queue/a'],
      ['content-type', 'text/plain']
    ]),
    body: writeString('a')
  };

  const sendError = await session.send(originalFrame);

  expect(sendError).toBeDefined();
  expect(sendError?.message).toBe('receipt timeout');

  expect(session.isDisconnected()).toBe(false);
});

test('latest receipt completes previous receipt requets', async () => {

  const server = new MockServer([], RECEIPT_SHORT_TIMEOUT);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const send1 = session.send(message([['destination', '/queue/a']], 'hello'));
  const send2 = session.send(message([['destination', '/queue/b']], 'hello'));
  const send3 = session.send(message([['destination', '/queue/c']], 'hello'));

  server.push(success(receipt('3')));

  const [send1Result, send2Result, send3Result] = await Promise.all([send1, send2, send3]);

  expect(send1Result).toBeUndefined();
  expect(send2Result).toBeUndefined();
  expect(send3Result).toBeUndefined();
});

test('reciept does not complete newer receipt request', async () => {

  const server = new MockServer([], RECEIPT_SHORT_TIMEOUT);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const send1 = session.send(message([['destination', '/queue/a']], 'hello'));
  const send2 = session.send(message([['destination', '/queue/b']], 'hello'));

  server.push(success(receipt('1')));

  const [send1Result, send2Result] = await Promise.all([send1, send2]);

  expect(send1Result).toBeUndefined();
  
  expect(send2Result).toBeDefined();
  expect(send2Result?.message).toBe('receipt timeout');
});

test('concurrent writes', (done) => {

  const server = new MockServer([receipt('1'), receipt('2')], RECEIPT_SHORT_TIMEOUT);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const a = session.send({command: 'SEND', headers: new FrameHeaders([['destination', '/queue/a']]), body: writeString('a')});
  const b = session.send({command: 'SEND', headers: new FrameHeaders([['destination', '/queue/b']]), body: writeString('b')});

  Promise.all([a, b]).then(value => {

    const aError = value[0];
    const bError = value[1];

    expect(aError).toBeUndefined();
    expect(bError).toBeUndefined();

    expect(server.calls.length).toBe(6);

    done();
  });
});

test('begin', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const result = await session.begin(RECEIPT_DEFAULT_TIMEOUT);

  if (result.error) {
    expect(result.error).toBeUndefined();
    return;
  }

  expect(server.calls.length).toBe(2);

  const frame: Frame = server.calls[1][1][0];

  expect(frame.command).toBe('BEGIN');
  expect(frame.headers.has('transaction')).toBe(true);

  expect(result.value).toBeDefined();

  const transaction = result.value;

  expect(transaction.id).toBe(frame.headers.get('transaction'));
});

test('commit', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const transaction = 'fake-transaction';

  const error = await session.commit(transaction, RECEIPT_DEFAULT_TIMEOUT);

  expect(error).toBeUndefined();

  expect(server.calls.length).toBe(2);

  const frame: Frame = server.calls[1][1][0];

  expect(frame.command).toBe('COMMIT');
  expect(frame.headers.get('transaction')).toBe(transaction);
});

test('abort', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const transaction = 'fake-transaction';

  const error = await session.abort(transaction, RECEIPT_DEFAULT_TIMEOUT);

  expect(error).toBeUndefined();

  expect(server.calls.length).toBe(2);

  const frame: Frame = server.calls[1][1][0];

  expect(frame.command).toBe('ABORT');
  expect(frame.headers.get('transaction')).toBe(transaction);
});

test('subscribe', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const destination = '/queue/a';

  const result = await session.subscribe(destination);

  if (result.error) {
    expect(result.error).toBeUndefined();
    return;
  }
  
  const subscription = result.value;

  expect(server.calls.length).toBe(2);

  const frame: Frame = server.calls[1][1][0];

  expect(frame.command).toBe('SUBSCRIBE');
  expect(frame.headers.get('destination')).toBe('/queue/a');
  expect(frame.headers.get('id')).toBe(subscription.id);

  if (frame.headers.has('ack')) {
    expect(frame.headers.get('ack')).toBe('auto');
  }
});

test('unsubscribe', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const subscription = {id: 'fake-subscription', headers: new FrameHeaders([])};

  const error = await session.unsubscribe(subscription, RECEIPT_DEFAULT_TIMEOUT);

  expect(error).toBeUndefined();

  expect(server.calls.length).toBe(2);

  const frame: Frame = server.calls[1][1][0];

  expect(frame.command).toBe('UNSUBSCRIBE');
  expect(frame.headers.get('id')).toBe(subscription.id);
});

test('unsubscribe cancels receive', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const subscription = {id: 'fake-subscription', headers: new FrameHeaders([])};

  const receive = session.receive(subscription);

  session.unsubscribe(subscription, RECEIPT_NOT_REQUESTED);

  const result = await receive;

  if (result.error) {
    expect(result.error).toBeUndefined();
    return;
  }

  expect(result.cancelled).toBe(true);
});

test('ack', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const messageId = '1';

  const sendError = await session.ack(messageId);

  expect(sendError).toBeUndefined();

  expect(server.calls.length).toBe(2);

  const frame: Frame = server.calls[1][1][0];

  expect(frame.command).toBe('ACK');
  expect(frame.headers.get('id')).toBe('1');
});

test('nack', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const messageId = '1';

  const sendError = await session.nack(messageId);

  expect(sendError).toBeUndefined();

  expect(server.calls.length).toBe(2);

  const frame: Frame = server.calls[1][1][0];

  expect(frame.command).toBe('NACK');
  expect(frame.headers.get('id')).toBe('1');
});

test('receive', async () => {

  const server = new MockServer([
    {command: 'MESSAGE', headers: new FrameHeaders([
      ['subscription', '1'],
      ['message-id', '007'],
      ['destination', '/queue/a'],
      ['content-type', 'text/plain']
    ]), body: writeString('hello')}
  ], RECEIPT_NOT_REQUESTED);

  const session = new ClientSession(server, STOMP_VERSION_12);

  const subscription = {id: '1', headers: new FrameHeaders([])};

  const result = await session.receive(subscription);

  if (result.error) {
    expect(result.error).toBeUndefined();
    return;
  }
  
  if (result.cancelled) {
    expect(result.cancelled).toBe(false);
    return;
  }

  expect(result.value).toBeDefined();

  const message = result.value;

  expect(message.command).toBe('MESSAGE');
  expect(message.headers.get('subscription')).toBe('1');
  expect(message.headers.get('message-id')).toBe('007');
  expect(message.headers.get('destination')).toBe('/queue/a');
  expect(message.headers.get('content-type')).toBe('text/plain');
  
  const bodyString = await readString(message.body);

  if (bodyString.error) {
    expect(bodyString.error).toBeUndefined();
    return;
  }

  expect(bodyString.value).toBe('hello');
});

test('cancelReceive', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const dummySubscription = {id: '1', headers: new FrameHeaders([])};

  const receive = session.receive(dummySubscription);

  session.cancelReceive(dummySubscription);

  const result = await receive;

  if (result.error) {
    expect(result.error).toBeUndefined();
    return;
  }

  expect(result.cancelled).toBe(true);
});

test('receive reset', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);

  const session = new ClientSession(server, STOMP_VERSION_12);

  const dummySubscription = {id: '1', headers: new FrameHeaders([])};

  const receive1 = session.receive(dummySubscription);
  const receive2 = session.receive(dummySubscription);

  server.push(success({
    command: 'MESSAGE',
    headers: new FrameHeaders([
      ['subscription', dummySubscription.id]
    ]),
    body: writeString('hello')
  }));

  const [result1, result2] = await Promise.all([receive1, receive2]);

  if (!result1) {
    expect(result1).toBeDefined();
    return;
  }

  if (result1.error) {
    expect(result1.error).toBeUndefined();
    return;
  }

  expect(result1.cancelled).toBe(true);

  if (!result2) {
    expect(result2).toBeDefined();
    return;
  }

  if (result2.error) {
    expect(result2.error).toBeUndefined();
    return;
  }

  if (result2.cancelled) {
    expect(result2.cancelled).toBe(false);
    return;
  }
});

test('readFrame fail', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const dummySubscription = {id: '1', headers: new FrameHeaders([])};

  const send = session.send(message([['destination', '/queue/a']], 'hello'), RECEIPT_SHORT_TIMEOUT);
  const receive = session.receive(dummySubscription);

  server.push(fail(new Error('fake transport error')));

  const [sendResult, receiveResult] = await Promise.all([send, receive]);

  expect(sendResult).toBeDefined();
  expect(sendResult?.message).toBe('session disconnected');

  if (receiveResult) {
    expect(receiveResult.error).toBeDefined();
    expect(receiveResult.error?.message).toBe('session disconnected');
  }
  
  expect(session.isDisconnected()).toBe(true);

  const disconnectError = session.getDisconnectError();

  expect(disconnectError).toBeDefined();
  expect(disconnectError?.message).toBe('fake transport error');

  const lastCall = server.calls[server.calls.length - 1];

  expect(lastCall[0]).toBe('close');
});

test('writeFrame fail', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  server.setWriteFrameResult(Promise.resolve(new Error('fake transport error')));

  const sendError = await session.send(message([['destination', '/queue/a']], 'hello'));

  expect(sendError).toBeDefined();
  expect(sendError?.message).toBe('session disconnected');

  expect(session.isDisconnected()).toBe(true);
  
  const lastCall = server.calls[server.calls.length - 1];

  expect(lastCall[0]).toBe('close');
});

test('disconnect', async () => {

  const server = new MockServer([receipt('1')], RECEIPT_SHORT_TIMEOUT);

  const session = new ClientSession(server, STOMP_VERSION_12);

  const error = await session.disconnect(RECEIPT_DEFAULT_TIMEOUT);

  expect(error).toBeUndefined();

  expect(session.isDisconnected()).toBe(true);

  const frame: Frame = server.calls[2][1][0];

  expect(frame.command).toBe('DISCONNECT');
  expect(frame.headers.get('receipt')).toBe('1');

  expect(server.calls[3][0]).toBe('close');
});

test('disconnect using send', async () => {

  const server = new MockServer([receipt('1')], RECEIPT_SHORT_TIMEOUT);

  const session = new ClientSession(server, STOMP_VERSION_12);

  const disconnect = {
    command: 'DISCONNECT',
    headers: new FrameHeaders([]),
    body: writeEmptyBody()
  };

  const sendError = await session.send(disconnect, RECEIPT_DEFAULT_TIMEOUT);

  expect(sendError).toBeUndefined();

  expect(session.isDisconnected()).toBe(true);

  const frame: Frame = server.calls[2][1][0];

  expect(frame.command).toBe('DISCONNECT');
  expect(frame.headers.get('receipt')).toBe('1');

  expect(server.calls[3][0]).toBe('close');
});

test('disconnect cancels receive', (done) => {

  const server = new MockServer([receipt('1')], RECEIPT_SHORT_TIMEOUT);

  const session = new ClientSession(server, STOMP_VERSION_12);

  const dummySubscription = {id: '1', headers: new FrameHeaders()};

  const message = session.receive(dummySubscription);

  const disconnect = session.disconnect();

  Promise.all([message, disconnect]).then((result) => {

    const [messageResult, disconnectError] = result;

    if (!messageResult) {
      expect(messageResult);
      return;
    }

    if (messageResult.error) {
      expect(messageResult.error).toBeUndefined();
      return;
    }

    expect(messageResult.cancelled).toBe(true);

    expect(disconnectError).toBeUndefined();

    done();
  });
});

test('unreceipt disconnect cancels receipts', async () => {

  const server = new MockServer([], RECEIPT_SHORT_TIMEOUT);

  const session = new ClientSession(server, STOMP_VERSION_12);

  const sendResult = session.send(message([['destination', '/queue/a']], 'hello'));

  const disconnectError = await session.disconnect(RECEIPT_NOT_REQUESTED);

  const sendError = await sendResult;

  expect(disconnectError).toBeUndefined();

  expect(sendError).toBeDefined();
  expect(sendError?.message).toBe('session disconnected');
});

test('async sends with sync disconnect', async () => {

  const server = new MockServer([receipt('1')], RECEIPT_SHORT_TIMEOUT);
  
  const session = new ClientSession(server, STOMP_VERSION_12);

  const send1 = session.send(message([['destination', '/queue/a']], 'hello'), RECEIPT_NOT_REQUESTED);
  const send2 = session.send(message([['destination', '/queue/b']], 'hello'), RECEIPT_NOT_REQUESTED);

  const disconnectError = await session.disconnect(RECEIPT_SHORT_TIMEOUT);

  expect(disconnectError).toBeUndefined();

  const [result1, result2] = await Promise.all([send1, send2]);

  expect(result1).toBeUndefined();
  expect(result2).toBeUndefined();
});

test('shutdown', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  session.shutdown();

  expect(session.isDisconnected()).toBe(true);

  expect(server.calls[0][0]).toBe('close');
});

test('shutdown cancels receive', (done) => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const dummySubscription = {
    id: '1', headers: new FrameHeaders([])
  };

  const message = session.receive(dummySubscription);

  session.shutdown();

  message.then(result => {

    if (result.error) {
      expect(result.error).toBeUndefined();
      return;
    }

    expect(result.cancelled).toBe(true);

    done();
  });
});

test('unhandled message', async() => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const receive = session.receive({id: '1', headers: new FrameHeaders([])});
  
  server.push(success({command: 'MESSAGE', headers: new FrameHeaders([['subscription', '2']]), body: writeString('hello')}));

  await receive;

  expect(session.isDisconnected()).toBe(true);

  const error = session.getDisconnectError();

  if(!error) {
    expect(error).toBeDefined();
    return;
  }

  expect(error.message).toBe('unhandled message');
});

test('receive unhandled message', async () => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const subscribeResult = await session.subscribe('/queue/test');

  if (subscribeResult.error) {
    expect(subscribeResult.error).toBeUndefined();
    return;
  }

  const subscription = subscribeResult.value;

  server.push(success({command: 'MESSAGE', headers: new FrameHeaders([['subscription', subscription.id]]), body: writeString('hello')}));

  // call receive for another subscription to get the receive loop running
  session.receive({id: '2', headers: new FrameHeaders([])});

  const receiveResult = await session.receive({id: subscription.id, headers: new FrameHeaders([])});

  if (receiveResult.error) {
    expect(receiveResult.error).toBeUndefined();
    return;
  }

  if (receiveResult.cancelled) {
    expect(receiveResult.cancelled).toBeUndefined();
    return;
  }
});

test('unhandled message after unsubscribe', async() => {

  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const subscribeResult = await session.subscribe('/queue/test');

  if (subscribeResult.error) {
    expect(subscribeResult.error).toBeUndefined();
    return;
  }

  const subscription = subscribeResult.value;

  await session.unsubscribe(subscription);
  
  server.push(success({command: 'MESSAGE', headers: new FrameHeaders([['subscription', subscription.id]]), body: writeString('hello')}));

  // call receive for another subscription to get the receive loop running
  await session.receive({id: '2', headers: new FrameHeaders([])});

  expect(session.isDisconnected()).toBe(true);

  const disconnectError = session.getDisconnectError();

  if (!disconnectError) {
    expect(disconnectError).toBeDefined();
  }
  
  expect(disconnectError?.message).toBe('unhandled message');
});
