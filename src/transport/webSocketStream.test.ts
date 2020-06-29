import { WebSocket, Server } from 'mock-socket';
import { createSignal } from '../concurrency';
import { encodeUtf8String, decodeString } from '../stream/chunk'; 
import { WebSocketStream } from './webSocketStream';

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

  client.addEventListener('close', () => {
    clientClosedSignal(undefined);
  });

  client.close();

  await clientClosed;
});
