import * as path from 'path';
import { VoidResult, failed, error } from '../../../src/result';
import { netConnect } from '../../../src/transport/netSocketStream';
import { connect } from '../../../src/client/connect';
import { ClientSession } from '../../../src/client/session';
import { FrameHeaders } from '../../../src/frame/header';
import { Config } from '../../config_utils';

type LogFunction = (...args: any[]) => void;
type SessionHandler = (session: ClientSession, log: LogFunction) => Promise<void>;

export function getConnectionConfig(): Config | undefined {

  const broker = process.env.BROKER || '';

  try {
    const client = require(`../../broker/${path.basename(broker)}/client`);
     
    if (client && client.getConnectionConfig) {
      return client.getConnectionConfig();
    }
  }
  catch(error) {
    return;
  }
}

export function logger(name: string): LogFunction {
  return (...args: any[]) => {
    console.log(`[${name}] `, ...args);
  };
}

export async function session(name: string, handler: SessionHandler): Promise<VoidResult> {

  const log = logger(name);

  const handleError = (message: string): Error => {
    log(message);
    return new Error(message);
  };

  const config = getConnectionConfig();

  if (!config) {
    return handleError('Config not found: BROKER env unset or the broker service is not running');
  }

  const tcpConnectResult = await netConnect({
    host: config.host,
    port: config.port
  });

  const endpoint = [config.host, config.port].join(':');

  if (failed(tcpConnectResult)) {
    return handleError(`Could not connect to ${endpoint}/tcp: ${error(tcpConnectResult).message}`);
  }

  log(`TCP connection established to ${endpoint}`);

  const transport = tcpConnectResult.value;

  const stompConnectResult = await connect(transport, FrameHeaders.fromMap(config.connectHeaders));

  if (failed(stompConnectResult)) {
    return handleError(`Could not establish STOMP session: ${error(stompConnectResult).message}`);
  }

  log('STOMP session established');

  const session = stompConnectResult.value;

  try {
    await handler(session, log);
  }
  catch (error) {

    const disconnectError = session.getDisconnectError();

    log(`Handler aborted: ${disconnectError ? disconnectError.message : error.message}`);

    session.shutdown();
    return error;
  }

  if (!session.isDisconnected()) {
    
    const disconnectError = await session.disconnect();

    if (disconnectError) {
      return handleError(`Disconnect error: ${disconnectError.message}`);
    }
  }

  log('Disconnected');
}
