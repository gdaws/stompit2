import { Result, failed } from './result';
import { FrameHeaders } from './frame/header';
import { Transport } from './transport';
import { connect as stompConnectImpl } from './client/connect';
import { ClientSession } from './client/session';

export { Result, failed, error, result, fail, ok } from './result';

export { ClientSession } from './client/session';
export { messageQueue } from './client/subscription';
export { jsonMessage } from './client/message';

export { readString, readJson } from './frame/body';

/**
 * Establish a STOMP session with the server over a transport
 *
 * @param transportConnect A connecting or connected transport
 * @param hostHeader Broker vhost value
 * @param username Credential used by broker to perform authentication
 * @param password Credential used by broker to perform authentication
 */
export async function stompConnect(transportConnect: Promise<Result<Transport>>, hostHeader: string, username: string, password: string): Promise<Result<ClientSession>> {

  const transConnectResult = await transportConnect;

  if (failed(transConnectResult)) {
    return transConnectResult;
  }

  const transport = transConnectResult.value;

  return stompConnectImpl(transport, FrameHeaders.fromEntries([
    ['host', hostHeader],
    ['username', username],
    ['passcode', password]
  ]));
}
