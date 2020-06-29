import { createServer, Socket } from 'net';
import * as net from 'net';
import { encodeUtf8String, decodeString } from '../stream/chunk';
import { TransportStream } from '../transport';
import { NetSocketStream } from './netSocketStream';

let serverClientSocket: Promise<Socket> | undefined;

const serverListeningSocket = createServer();

const listening = new Promise((resolve, reject) => {
  serverListeningSocket.on('error', reject);
  serverListeningSocket.listen(resolve);
});

const prepareServer = () => {

  if (serverClientSocket) {
    serverClientSocket.then(socket => socket.destroy());
  }

  if (!serverListeningSocket) {
    serverClientSocket = undefined;
    return;
  }
  
  serverClientSocket = new Promise((resolve, reject) => {
    if (!serverListeningSocket.listening) {
      reject(new Error('server is not listening'));
    }
    serverListeningSocket.once('connection', resolve);
  });
};

function connect(): Promise<[NetSocketStream, NetSocketStream]> {

  return new Promise((resolve, reject) => {

    const serverAddress = serverListeningSocket.address();

    if (null === serverAddress) {
      reject(new Error('server is not listening'));
      return;
    }
  
    let options;
  
    if (typeof serverAddress === 'string') {
      throw new Error('invalid server address');
    }
    else {
      options = {
        port: serverAddress.port,
        host: serverAddress.family === 'IPv4' ? '127.0.0.1' : '::1'
      };
    }

    const client = net.connect(options, () => {

      if (!serverClientSocket) {
        reject(new Error('server client socket unprepared'));
        return;
      }

      serverClientSocket.then((server) => {
        resolve([
          new NetSocketStream(client),
          new NetSocketStream(server)
        ]);
      }).catch(reject);
    });

    client.once('error', reject);
  });
}

beforeAll(async () => {
  await listening;
});

afterAll(async () => {

  if (serverClientSocket) {
    const socket = await serverClientSocket;
    socket.destroy();
  }

  serverListeningSocket.close();
});

beforeEach(() => {
  prepareServer();
});

test('data transfer', async () => {

  const [client, server] = await connect();

  const clientWriteError = await client.write(encodeUtf8String('hello server'));

  expect(clientWriteError).toBeUndefined();

  const clientReadIterator = client[Symbol.asyncIterator]();
  const serverReadIterator = server[Symbol.asyncIterator]();

  const clientRead = clientReadIterator.next();

  const serverReadResult = await serverReadIterator.next();

  expect(serverReadResult.done).toBe(false);
  expect(serverReadResult.value).toBeDefined();

  expect(decodeString(serverReadResult.value)).toBe('hello server');

  expect(client.bytesWritten).toBe(12);
  expect(server.bytesRead).toBe(12);

  client.close();

  const clientReadResult = await clientRead;

  expect(clientReadResult.done).toBe(true);
  expect(clientReadResult.value).toBeUndefined();

  const serverSecondReadResult = await serverReadIterator.next();

  expect(serverSecondReadResult.done).toBe(true);
  expect(serverSecondReadResult.value).toBeUndefined();
});
