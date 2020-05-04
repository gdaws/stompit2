import { fail, Result } from './result';
import { RECEIPT_NOT_REQUESTED } from './client/receipt';
import { FrameHeaders } from './frame/header';
import { Frame } from './frame/protocol';
import { ClientSession, MessageResult } from './client/session';
import { discardMessages } from './client/message';

/**
 * Send a request message to the RabbitMQ broker and wait for a reply
 * 
 * @param message The request message
 * @param replyTimeout The number of milliseconds to wait for a reply
 * @param session The ClientSession object
 * @return The reply frame
 */
export async function request(message: Frame, replyTimeout: number, session: ClientSession): Promise<MessageResult> {

  const replyTo = `/temp-queue/request-${session.generateResourceId()}`;

  const subscription = {id: replyTo, headers: new FrameHeaders([['destination', replyTo]])};

  const replyMessage = session.receive(subscription);

  const timeout = replyTimeout > 0 ? setTimeout(() => {
    session.cancelReceive(subscription);
    discardMessages(null, subscription, session);
  }, replyTimeout) : undefined;

  const sendError = await session.send({
    command: 'SEND',
    headers: FrameHeaders.merge(message.headers, new FrameHeaders([
      ['reply-to', replyTo]
    ])),
    body: message.body
  }, RECEIPT_NOT_REQUESTED);

  if (sendError) {
    return fail(sendError);
  }

  const result = await replyMessage;

  if (timeout) {
    clearTimeout(timeout);
  }

  // Because an internal subscription cannot be cancelled we must be prepared 
  // to handle any further messages

  discardMessages(null, subscription, session);

  return result;
}
