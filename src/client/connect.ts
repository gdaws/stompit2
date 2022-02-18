import { ok, fail, errorCode, failed, Result } from '../result';
import { FrameHeaders } from '../frame/header';
import { writeEmptyBody, readEmptyBody } from '../frame/body';
import { readServerError } from '../frame/error';

import {
  Frame,
  STOMP_VERSION_10,
  acceptedVersions,
  supportedProtocolVersion
} from '../frame/protocol';

import { Transport } from '../transport';
import { ClientSession } from './session';

/**
 * Initiate a client session with the server.
 *
 * @param transport Connected transport
 * @param headers Headers to include in the connect frame.
 *
 *  Supported headers:
 *  * `'host'` - REQUIRED
 *  * `'login'`
 *  * `'passcode'`
 *
 * @return A connected ClientSession object
 */
export async function connect(transport: Transport, headers: FrameHeaders): Promise<Result<ClientSession>> {
  const connectFrame: Frame = {
    command: 'CONNECT',
    headers: FrameHeaders.merge(headers, FrameHeaders.fromEntries([
      ['accept-version', acceptedVersions().join(',')]
    ])),
    body: writeEmptyBody()
  };

  if (headers.has('heart-beat')) {
    // Remove heart-beat header
    connectFrame.headers = connectFrame.headers.filter(([name, _value]) => name !== 'heart-beat');

    // Heart beating is managed by the transport layer
  }

  const writeError = await transport.writeFrame(connectFrame, STOMP_VERSION_10);

  if (writeError) {
    return errorCode('TransportFailure', writeError.message);
  }

  const readResult = await transport.readFrame(STOMP_VERSION_10);

  if (failed(readResult)) {
    transport.close();
    return readResult;
  }

  const response = readResult.value;

  if ('ERROR' === response.command) {
    const serverError = await readServerError(response);

    transport.close();
    return fail(serverError);
  }

  if ('CONNECTED' !== response.command) {
    transport.close();
    return errorCode('ProtocolViolation', `server sent ${response.command.substring(0, 31)} frame (expected CONNECTED frame)`)
  }

  const versionString = response.headers.get('version');

  if (undefined === versionString) {
    transport.close();
    return errorCode('ProtocolViolation', 'connect failed');
  }

  const version = supportedProtocolVersion(versionString);

  if (!version) {
    transport.close();
    return errorCode('ProtocolViolation', 'protocol version unsupported');
  }

  const bodyResult = await readEmptyBody(response.body);

  if (failed(bodyResult)) {
    transport.close();
    return bodyResult;
  }

  return ok(new ClientSession(transport, version));
}
