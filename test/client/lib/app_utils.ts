import * as path from 'path';
import { VoidResult, failed, error } from '../../../src/result';
import { StompitError, isStompitError } from '../../../src/error';
import { netConnect } from '../../../src/transport/netSocketStream';
import { limitDefaults } from '../../../src/transport';
import { connect } from '../../../src/client/connect';
import { ClientSession } from '../../../src/client/session';
import { FrameHeaders } from '../../../src/frame/header';
import { Config } from '../../config_utils';

type LogFunction = (...args: any[]) => void;
type SessionHandler = (session: ClientSession, log: LogFunction) => Promise<void>;

export function getConnectionConfig(): Config | undefined {
  const broker = process.env.BROKER || '';

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client = require(`../../broker/${path.basename(broker)}/client`);

    if (client && client.getConnectionConfig) {
      return {
        moduleName: broker,
        ...client.getConnectionConfig()
      };
    }
  }
  catch (error) {
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

  const handleError = (message: string): StompitError => {
    log(message);
    return new StompitError('SessionClosed', message);
  };

  const config = getConnectionConfig();

  if (!config) {
    return handleError('Config not found: BROKER env unset or the broker service is not running');
  }

  const transportLimits = { ...limitDefaults };

  if ('activemq' === config.moduleName) {
    transportLimits.desiredReadRate = 0;
    transportLimits.desiredWriteRate = 0;
  }

  const tcpConnectResult = await netConnect({
    host: config.host,
    port: config.port
  }, transportLimits);

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
    session.shutdown();

    if (isStompitError(error)) {
      log(`Handler aborted: ${error.message}`);
      return error;
    }
    else {
      log(`Handler aborted: ${error instanceof Error ? error.message : 'unknown message'}`);
      return new StompitError('OperationCancelled', 'unknown error');
    }
  }

  if (!session.isDisconnected()) {
    const disconnectError = await session.disconnect();

    if (disconnectError) {
      return handleError(`Disconnect error: ${disconnectError.message}`);
    }
  }

  log('Disconnected');
}
