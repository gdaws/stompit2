import { Result, result, ok, fail, failed, error, RESULT_CANCELLED, RESULT_OK } from '../result';
import { createQueue, Queue } from '../queue';
import { Frame, STOMP_VERSION_12 } from '../frame/protocol';
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
}

class MockServer implements Transport {
  private receiptTimeout: number;

  public resultQueue: Queue<Result<Frame>>;

  private writeFrameResult: Promise<Error | undefined>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public calls: [keyof MockServer, any[]][];

  public constructor(outputFrames: Frame[], receiptTimeout: number) {
    this.receiptTimeout = receiptTimeout;

    this.resultQueue = createQueue<Result<Frame>>();

    for (const frame of outputFrames) {
      this.resultQueue[0].push(ok(frame));
    }

    outputFrames.map(frame => ok(frame));

    this.writeFrameResult = Promise.resolve(undefined);
    this.calls = [];
  }

  public getReceiptTimeout() {
    // eslint-disable-next-line prefer-rest-params
    this.calls.push(['getReceiptTimeout', [...arguments]]);
    return this.receiptTimeout;
  }

  public async readFrame(): Promise<Result<Frame>> {
    // eslint-disable-next-line prefer-rest-params
    this.calls.push(['readFrame', [...arguments]]);

    const iterator = this.resultQueue[1][Symbol.asyncIterator]();

    const iterResult = await iterator.next();

    if (iterResult.done) {
      return fail(new Error('input stream terminated'));
    }

    return iterResult.value;
  }

  public push(result: Result<Frame>) {
    this.resultQueue[0].push(result);
  }

  public setWriteFrameResult(result: Promise<Error | undefined>) {
    this.writeFrameResult = result;
  }

  public writeFrame(): Promise<Error | undefined> {
    // eslint-disable-next-line prefer-rest-params
    this.calls.push(['writeFrame', [...arguments]]);
    return this.writeFrameResult;
  }

  public close() {
    // eslint-disable-next-line prefer-rest-params
    this.calls.push(['close', [...arguments]]);
    return Promise.resolve();
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

  const body = result(await readString(frame.body));

  expect(body).toBe('hello');
});

test('send after shutdown', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  session.shutdown();

  const originalFrame = {
    command: 'SEND',
    headers: new FrameHeaders([['destination', '/queue/test']]),
    body: writeString('hello')
  };

  const sendError = await session.send(originalFrame);

  expect(sendError).toBeDefined();
  expect(sendError?.message).toBe('session disconnected');
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

  server.push(ok(receipt('3')));

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

  server.push(ok(receipt('1')));

  const [send1Result, send2Result] = await Promise.all([send1, send2]);

  expect(send1Result).toBeUndefined();

  expect(send2Result).toBeDefined();
  expect(send2Result?.message).toBe('receipt timeout');
});

test('concurrent writes', (done) => {
  const server = new MockServer([receipt('1'), receipt('2')], RECEIPT_SHORT_TIMEOUT);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const a = session.send({ command: 'SEND', headers: new FrameHeaders([['destination', '/queue/a']]), body: writeString('a') });
  const b = session.send({ command: 'SEND', headers: new FrameHeaders([['destination', '/queue/b']]), body: writeString('b') });

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

  const transaction = result(await session.begin(RECEIPT_DEFAULT_TIMEOUT));

  expect(server.calls.length).toBe(2);

  const frame: Frame = server.calls[1][1][0];

  expect(frame.command).toBe('BEGIN');
  expect(frame.headers.has('transaction')).toBe(true);

  expect(transaction.id).toBe(frame.headers.get('transaction'));
});

test('begin error', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  server.setWriteFrameResult(Promise.resolve(new Error('test')));

  const result = await session.begin(RECEIPT_DEFAULT_TIMEOUT);

  expect(failed(result)).toBe(true);
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

test('commit error', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  server.setWriteFrameResult(Promise.resolve(new Error('test')));

  const transaction = 'fake-transaction';

  const error = await session.commit(transaction, RECEIPT_DEFAULT_TIMEOUT);

  expect(error).toBeDefined();
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


test('abort error', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  server.setWriteFrameResult(Promise.resolve(new Error('test')));

  const transaction = 'fake-transaction';

  const error = await session.abort(transaction, RECEIPT_DEFAULT_TIMEOUT);

  expect(error).toBeDefined();
});

test('subscribe', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const destination = '/queue/a';

  const subscription = result(await session.subscribe(destination));

  expect(server.calls.length).toBe(2);

  const frame: Frame = server.calls[1][1][0];

  expect(frame.command).toBe('SUBSCRIBE');
  expect(frame.headers.get('destination')).toBe('/queue/a');
  expect(frame.headers.get('id')).toBe(subscription.id);

  if (frame.headers.has('ack')) {
    expect(frame.headers.get('ack')).toBe('auto');
  }
});

test('subscribe error', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  server.setWriteFrameResult(Promise.resolve(new Error('test')));

  const result = await session.subscribe('/queue/a');

  expect(failed(result)).toBe(true);
});

test('unsubscribe', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const subscription = { id: 'fake-subscription', headers: new FrameHeaders([]) };

  const error = await session.unsubscribe(subscription, RECEIPT_DEFAULT_TIMEOUT);

  expect(error).toBeUndefined();

  expect(server.calls.length).toBe(2);

  const frame: Frame = server.calls[1][1][0];

  expect(frame.command).toBe('UNSUBSCRIBE');
  expect(frame.headers.get('id')).toBe(subscription.id);
});

test('unsubscribe error', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  server.setWriteFrameResult(Promise.resolve(new Error('test')));

  const subscription = { id: 'fake-subscription', headers: new FrameHeaders([]) };

  const error = await session.unsubscribe(subscription, RECEIPT_DEFAULT_TIMEOUT);

  expect(error).toBeDefined();
});

test('unsubscribe cancels receive', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const subscription = { id: 'fake-subscription', headers: new FrameHeaders([]) };

  const receive = session.receive(subscription);

  session.unsubscribe(subscription, RECEIPT_NOT_REQUESTED);

  const result = await receive;

  expect(result.status).toBe(RESULT_CANCELLED);
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
    {
      command: 'MESSAGE', headers: new FrameHeaders([
        ['subscription', '1'],
        ['message-id', '007'],
        ['destination', '/queue/a'],
        ['content-type', 'text/plain']
      ]), body: writeString('hello')
    }
  ], RECEIPT_NOT_REQUESTED);

  const session = new ClientSession(server, STOMP_VERSION_12);

  const subscription = { id: '1', headers: new FrameHeaders([]) };

  const message = result(await session.receive(subscription));

  expect(message.command).toBe('MESSAGE');
  expect(message.headers.get('subscription')).toBe('1');
  expect(message.headers.get('message-id')).toBe('007');
  expect(message.headers.get('destination')).toBe('/queue/a');
  expect(message.headers.get('content-type')).toBe('text/plain');

  const bodyString = result(await readString(message.body));

  expect(bodyString).toBe('hello');
});

test('cancelReceive', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const dummySubscription = { id: '1', headers: new FrameHeaders([]) };

  const receive = session.receive(dummySubscription);

  session.cancelReceive(dummySubscription);

  const result = await receive;

  expect(result.status).toBe(RESULT_CANCELLED);
});

test('cancelReceive on unknown operation', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  session.cancelReceive({ id: 'unknown', headers: new FrameHeaders([]) });
});

test('receive reset', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);

  const session = new ClientSession(server, STOMP_VERSION_12);

  const dummySubscription = { id: '1', headers: new FrameHeaders([]) };

  const receive1 = session.receive(dummySubscription);
  const receive2 = session.receive(dummySubscription);

  server.push(ok({
    command: 'MESSAGE',
    headers: new FrameHeaders([
      ['subscription', dummySubscription.id]
    ]),
    body: writeString('hello')
  }));

  const [result1, result2] = await Promise.all([receive1, receive2]);

  expect(result1.status).toBe(RESULT_CANCELLED);
  expect(result2.status).toBe(RESULT_OK);
});

test('readFrame fail', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const dummySubscription = { id: '1', headers: new FrameHeaders([]) };

  const send = session.send(message([['destination', '/queue/a']], 'hello'), RECEIPT_SHORT_TIMEOUT);
  const receive = session.receive(dummySubscription);

  server.push(fail(new Error('fake transport error')));

  const [sendError, receiveResult] = await Promise.all([send, receive]);

  expect(sendError && sendError.message).toBe('session disconnected');

  expect(failed(receiveResult) && error(receiveResult).message).toBe('session disconnected');

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

  const dummySubscription = { id: '1', headers: new FrameHeaders() };

  const message = session.receive(dummySubscription);

  const disconnect = session.disconnect();

  Promise.all([message, disconnect]).then((result) => {
    const [messageResult, disconnectError] = result;

    expect(messageResult && messageResult.status).toBe(RESULT_CANCELLED);

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

  const numCallsAfterFirstShutdown = server.calls.length;

  session.shutdown();

  expect(server.calls.length).toBe(numCallsAfterFirstShutdown);
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
    expect(result.status).toBe(RESULT_CANCELLED);

    done();
  });
});

test('unhandled message', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const receive = session.receive({ id: '1', headers: new FrameHeaders([]) });

  server.push(ok({ command: 'MESSAGE', headers: new FrameHeaders([['subscription', '2']]), body: writeString('hello') }));

  await receive;

  expect(session.isDisconnected()).toBe(true);

  const error = session.getDisconnectError();

  if (!error) {
    expect(error).toBeDefined();
    return;
  }

  expect(error.message).toBe('unhandled message');
});

test('receive unhandled message', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const subscription = result(await session.subscribe('/queue/test'));

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  server.push(ok({ command: 'MESSAGE', headers: new FrameHeaders([['subscription', subscription.id]]), body: writeString('hello') }));

  // call receive for another subscription to get the receive loop running
  session.receive({ id: subscription.id + '_different', headers: new FrameHeaders([]) });

  // FIXME find a more reliable way to synchronise
  await sleep(1);

  result(await session.receive({ id: subscription.id, headers: new FrameHeaders([]) }));
});

test('unhandled message after unsubscribe', async () => {
  const server = new MockServer([], RECEIPT_NOT_REQUESTED);
  const session = new ClientSession(server, STOMP_VERSION_12);

  const subscription = result(await session.subscribe('/queue/test'));

  await session.unsubscribe(subscription);

  server.push(ok({ command: 'MESSAGE', headers: new FrameHeaders([['subscription', subscription.id]]), body: writeString('hello') }));

  // call receive for another subscription to get the receive loop running
  await session.receive({ id: '2', headers: new FrameHeaders([]) });

  expect(session.isDisconnected()).toBe(true);

  const disconnectError = session.getDisconnectError();

  if (!disconnectError) {
    expect(disconnectError).toBeDefined();
  }

  expect(disconnectError?.message).toBe('unhandled message');
});
