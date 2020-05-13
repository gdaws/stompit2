import { createServer, Socket } from 'net';
import * as net from 'net';
import { Result } from '../result';
import { TransportLimits } from '../transport';
import { NetSocket } from './netSocket';
import { STOMP_VERSION_12, Frame, STOMP_VERSION_10 } from '../frame/protocol';
import { FrameHeaders } from '../frame/header';
import { writeString, readString, writeEmptyBody } from '../frame/body';

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

function connect(clientTransportLimits?: Partial<TransportLimits>, serverTransportLimits?: Partial<TransportLimits>): Promise<[NetSocket, NetSocket]> {

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
          new NetSocket(client, {...NetSocket.getLimitDefaults(), ...(clientTransportLimits || {})}),
          new NetSocket(server, {...NetSocket.getLimitDefaults(), ...(serverTransportLimits || {})})
        ]);
      }).catch(reject);
    });

    client.once('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function getReadValue(result: Result<Frame> | undefined): Frame {

  if (!result) {
    expect(result).toBeDefined();
    throw new Error('getReadValue failed');
  }

  if(result.error) {
    expect(result.error).toBeUndefined();
    throw new Error('getReadValue failed');
  }

  return result.value;
}

async function getStringBody(frame: Frame): Promise<string> {

  const result = await readString(frame.body);

  if (result.error) {
    expect(result.error).toBeUndefined();
    return '';
  }

  return result.value;
}

test('close', async () => {

  const [client, server] = await connect();

  const socket = client.getSocket();

  const socketEnded = new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('end', resolve);
  });

  client.close();

  await socketEnded;
});

test('socket error', async () => {

  const [client, server] = await connect();

  const socket = client.getSocket();

  const read = client.readFrame(STOMP_VERSION_12);

  socket.destroy(new Error('session timeout'));

  const readResult = await read;

  if(!readResult.error) {
    expect(readResult.error).toBeDefined();
  }

  expect(readResult.error?.message).toBe('session timeout');
});

test('frame serialisation', async () => {

  const [client, server] = await connect();

  const read = server.readFrame(STOMP_VERSION_12);

  const write = client.writeFrame({
    command: 'SEND', 
    headers: new FrameHeaders([
      ['destination', '/queue/a']
    ]),
    body: writeString('hello')
  }, STOMP_VERSION_12);

  const [readResult, writeError] = await Promise.all([read, write]);

  expect(writeError).toBeUndefined();

  const frame = getReadValue(readResult);

  expect(frame.command).toBe('SEND');
  expect(frame.headers.get('destination')).toBe('/queue/a');

  const value = await getStringBody(frame);

  expect(value).toBe('hello');
});

test('heartbeat', async () => {

  const clientLimits: Partial<TransportLimits> = {
    desiredReadRate: 10,
    desiredWriteRate: 5,
    delayTolerance: 5
  };

  const serverLimits: Partial<TransportLimits> = {
    desiredReadRate: 10,
    desiredWriteRate: 0,
    delayTolerance: 5
  };

  const [client, server] = await connect(clientLimits, serverLimits);

  await client.writeFrame({command: 'CONNECT', headers: new FrameHeaders([['host', '/']]), body: writeEmptyBody()}, STOMP_VERSION_10);

  const connectReadResult = await server.readFrame(STOMP_VERSION_10);

  if (connectReadResult.error) {
    expect(connectReadResult.error).toBeUndefined();
    return;
  }

  const connectFrame = connectReadResult.value;

  expect(connectFrame.command).toBe('CONNECT');
  expect(connectFrame.headers.get('host')).toBe('/');
  expect(connectFrame.headers.get('heart-beat')).toBe('5,10');

  server.writeFrame({command: 'CONNECTED', headers: new FrameHeaders([['heart-beat', '5,10']]), body: writeEmptyBody()}, STOMP_VERSION_10);

  const connectedReadResult = await client.readFrame(STOMP_VERSION_10);

  if (connectedReadResult.error) {
    expect(connectedReadResult.error).toBeUndefined();
    return;
  }

  const connectedFrame = connectedReadResult.value;

  expect(connectedFrame.command).toBe('CONNECTED');
  expect(connectedFrame.headers.get('heart-beat')).toBe('0,10');

  const clientSocket = client.getSocket();
  const serverSocket = server.getSocket();

  const clientStart = [clientSocket.bytesRead, clientSocket.bytesWritten];
  const serverStart = [serverSocket.bytesRead, serverSocket.bytesWritten];

  const clientRead = client.readFrame(STOMP_VERSION_12);
  const serverRead = server.readFrame(STOMP_VERSION_12);

  const beats = 4;

  await sleep(15 * beats);

  expect(client.getSocket().bytesWritten - clientStart[1]).toBeGreaterThanOrEqual(beats);
  expect(server.getSocket().bytesRead - serverStart[0]).toBeGreaterThanOrEqual(beats);
});
