import { WebSocket, Server } from 'mock-socket';
import { createSignal } from '../concurrency';
import { result, failed, error } from '../result';
import { encodeUtf8String, decodeString } from '../stream/chunk'; 
import { WebSocketStream, wsConnect } from './webSocketStream';

class MockBlob extends Blob {

  private _buffer: ArrayBuffer;

  constructor(buffer: ArrayBuffer) {
    super([buffer]);
    this._buffer = buffer;
  }

  async arrayBuffer() {
    return this._buffer;
  }
};

test('data transfer', async () => {

  const url = 'ws://localhost:8080';

  const server = new Server(url);

  const [serverReceivedData, serverReceivedDataSignal] = createSignal<string>();
  const [clientClosed, clientClosedSignal] = createSignal();

  server.on('connection', socket => {

    socket.on('message', data => {

      if (data instanceof Uint8Array) {
        serverReceivedDataSignal(decodeString(data));
      }

      socket.send('hello client');
      socket.send(encodeUtf8String('hello client').buffer);
      socket.send(new MockBlob(encodeUtf8String('hello client').buffer));
    });
  });

  const client = new WebSocket(url);
  client.binaryType = 'arraybuffer';

  const clientStream = new WebSocketStream(client);

  const clientWriteError = await clientStream.write(encodeUtf8String('hello server'));

  expect(clientWriteError).toBeUndefined();

  expect(await serverReceivedData).toBe('hello server');

  const clientReadIterator = clientStream[Symbol.asyncIterator]();

  const clientReadResult = await clientReadIterator.next();

  expect(clientReadResult.done).toBe(false);
  
  if (!clientReadResult.value) {
    expect(clientReadResult.value).toBeDefined();
    return;
  }

  expect(decodeString(clientReadResult.value)).toBe('hello client');

  const clientSecondReadResult = await clientReadIterator.next();

  expect(clientSecondReadResult.done).toBe(false);
  
  if (!clientSecondReadResult.value) {
    expect(clientSecondReadResult.value).toBeDefined();
    return;
  }

  expect(decodeString(clientSecondReadResult.value)).toBe('hello client');

  const clientThirdReadResult = await clientReadIterator.next();

  expect(clientThirdReadResult.done).toBe(false);
  
  if (!clientThirdReadResult.value) {
    expect(clientThirdReadResult.value).toBeDefined();
    return;
  }

  expect(decodeString(clientThirdReadResult.value)).toBe('hello client');

  client.addEventListener('close', () => {
    clientClosedSignal(undefined);
  });

  client.close();

  const postClosingWriteResult = await clientStream.write(encodeUtf8String('this should fail'));

  expect(postClosingWriteResult).toBeDefined();
  expect(postClosingWriteResult?.message).toBe('socket is closing');

  await clientClosed;

  const postCloseWriteResult = await clientStream.write(encodeUtf8String('this should fail'));

  expect(postCloseWriteResult).toBeDefined();
  expect(postCloseWriteResult?.message).toBe('socket is closed');
});

test('wsConnect', async () => {

  global.WebSocket = WebSocket;

  const url = 'ws://localhost:8081';

  new Server(url);

  const transport = result(await wsConnect(url));

  transport.close();
});

test('wsConnect error', async () => {

  class MockFailWebSocket extends WebSocket {
    constructor(url: string) {
      super(url);
      throw new Error('could not connect');
    }
  };
  
  global.WebSocket = MockFailWebSocket;

  const url = 'ws://non-existent:8081';

  const result = await wsConnect(url);

  expect(failed(result));
});
