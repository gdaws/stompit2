import { VoidResult } from '../../../src/result';
import { NetSocket } from '../../../src/transport/netSocket';
import { connect } from '../../../src/client/connect';
import { ClientSession } from '../../../src/client/session';
import { FrameHeaders } from '../../../src/frame/header';
import { Config } from '../../config_utils';

type LogFunction = (...args: any[]) => void;
type SessionHandler = (session: ClientSession, log: LogFunction) => Promise<void>;

export function getConnectionConfig(): Config | undefined {

  const broker = process.env.BROKER;

  switch (broker) {
    case 'rabbitmq':
      const client = require('../../broker/rabbitmq/client');
      if (client && client.getConnectionConfig) {
        return client.getConnectionConfig();
      }
  }
}

export function logger(name: string): LogFunction {
  let count = 1;
  return (...args: any[]) => {
    console.log(`[${name}: ${count++}] `, ...args);
  };
}

export async function session(name: string, handler: SessionHandler): Promise<VoidResult> {

  const log = logger(name);

  const error = (message: string): Error => {
    log(message);
    return new Error(message);
  };

  const config = getConnectionConfig();

  if (!config) {
    return error('Config not found: BROKER env unset or the broker service is not running');
  }

  const tcpConnectResult = await NetSocket.connect({
    host: config.host,
    port: config.port
  });

  const endpoint = [config.host, config.port].join(':');

  if (tcpConnectResult.error) {
    return error(`Could not connect to ${endpoint}/tcp: ${tcpConnectResult.error.message}`);
  }

  log(`TCP connection established to ${endpoint}`);

  const transport = tcpConnectResult.value;

  const stompConnectResult = await connect(transport, FrameHeaders.fromMap(config.connectHeaders));

  if (stompConnectResult.error) {
    return error(`Could not establish STOMP session: ${stompConnectResult.error.message}`);
  }

  log('STOMP session established');

  const session = stompConnectResult.value;

  try {
    await handler(session, log);
  }
  catch (error) {
    log(`Handler aborted: ${error.message}`);
    session.shutdown();
    return error;
  }

  if (!session.isDisconnected()) {
    
    const disconnectError = await session.disconnect();

    if (disconnectError) {
      return error(`Disconnect error: ${disconnectError.message}`);
    }
  }

  log('Disconnected');
}
