import { StompitError, ServerError, LoadedErrorFrame } from '../error';
import { failed } from '../result';
import { Frame } from './protocol';
import { readString } from './body';

const ERROR_RESPONSE_CONTENT_ENCODING = 'utf8';
const ERROR_RESPONSE_MAX_CONTENT_LENGTH = 4096;
const ERROR_RESPONSE_DEFAULT_MESSAGE = 'server error response';

export async function readServerError(frame: Frame, defaultMessage: string = ERROR_RESPONSE_DEFAULT_MESSAGE): Promise<StompitError> {
  const errorMessages: string[] = [];

  const message = frame.headers.get('message');

  if (message) {
    errorMessages.push(message);
  }

  const contentType = frame.headers.get('content-type');

  const readResult = await readString(frame.body, ERROR_RESPONSE_CONTENT_ENCODING, ERROR_RESPONSE_MAX_CONTENT_LENGTH);

  if (failed(readResult)) {
    return new StompitError('TransportFailure', 'unable to read ERROR frame body');
  }

  const body = readResult.value;

  if (contentType === 'text/plain') {
    errorMessages.push(body);
  }

  const loadedErrorFrame: LoadedErrorFrame = {
    command: 'ERROR',
    headers: frame.headers,
    body
  };

  return new ServerError(loadedErrorFrame, errorMessages.length > 0 ? `server response: ${errorMessages.join(': ')}` : defaultMessage);
}
