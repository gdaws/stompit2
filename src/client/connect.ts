import { success, fail, Result } from '../result';
import { FrameHeaders } from '../frame/header';

import { 
  Frame,
  STOMP_VERSION_10,
  acceptedVersions,
  supportedProtocolVersion
} from '../frame/protocol';

import { Transport } from '../transport';
import { writeEmptyBody, readEmptyBody } from '../frame/body';
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
      ['accept-version',  acceptedVersions().join(',')]
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
    return fail(writeError);
  }

  const readResult = await transport.readFrame(STOMP_VERSION_10);

  if (readResult.error) {
    return fail(readResult.error);
  }

  const response = readResult.value;

  if ('ERROR' === response.command) {
    return fail(new Error('server sent ERROR frame'));
  }

  if ('CONNECTED' !== response.command) {
    return fail(new Error(`server sent ${response.command.substring(0, 31)} frame`))
  }

  const versionString = response.headers.get('version');

  if (undefined === versionString) {
    return fail(new Error('server sent CONNECTED frame without including version header'));
  }

  const version = supportedProtocolVersion(versionString);

  if (!version) {
    return fail(new Error('protocol version unsupported'));
  }

  const bodyResult = await readEmptyBody(response.body);

  if (bodyResult.error) {
    return fail(bodyResult.error);
  }

  return success(new ClientSession(transport, version));
}
