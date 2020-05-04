import { Subscription, ClientSession } from './session';
import { RECEIPT_DEFAULT_TIMEOUT } from './receipt';
import { FrameHeaders } from '../frame/header';
import { writeBuffer } from '../frame/body';
import { Frame, getAckMode } from '../frame/protocol';

/**
 * A helper function to construct a sendable JSON message.
 * 
 * @param destination 
 * @param content 
 */
export function jsonMessage(destination: string, content: any): Frame {

  const source = JSON.stringify(content);

  const buffer = Buffer.from(source, 'utf-8');

  return {
    command: 'SEND',
    headers: new FrameHeaders([
      ['destination', destination],
      ['content-type', 'application/json'],
      ['content-length', '' + buffer.length]
    ]),
    body: writeBuffer(buffer)
  };
}

/**
 * A helper function that discards all messages received on a subscription.
 * 
 * @param ack The acknowledgement message type to send to the server. Pass null argument to not send any acknowledgements.
 */
export async function discardMessages(ack: null | 'ack' | 'nack', subscription: Subscription, session: ClientSession): Promise<void> {

  const messageResult = await session.receive(subscription);

  if (messageResult.error) {
    return;
  }

  const message = messageResult.value;

  if (!message) {
    return;
  }

  for await (const chunk of message.body) {
    // Do nothing
  }

  const messageId = message.headers.get('message-id');

  if (null !== ack && undefined !== messageId) {

    const mode = getAckMode(subscription.headers.get('ack'), session.getProtocolVersion());
    
    if (mode && mode !== 'auto') {
      session[ack].call(session, messageId, undefined, RECEIPT_DEFAULT_TIMEOUT);
    }
  }

  discardMessages(ack, subscription, session);
}
