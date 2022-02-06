import { result, ok, fail } from '../result';
import { FrameHeaders } from '../frame/header';
import { readString, writeString } from '../frame/body';
import { Producer, Consumer, createQueue } from '../queue';
import { RECEIPT_DEFAULT_TIMEOUT } from './receipt';
import { Receivable, AckSendable, MessageResult, SendResult } from './session';
import { jsonMessage, discardMessages } from './message';

test('jsonMessage', async () => {
  const frame = jsonMessage('/queue/test', { a: 1, b: true, c: 'test' });

  expect(frame.command).toBe('SEND');
  expect(frame.headers.get('destination')).toBe('/queue/test');
  expect(frame.headers.get('content-type')).toBe('application/json');

  const bodyString = result(await readString(frame.body));

  const content = JSON.parse(bodyString);

  expect(content.a).toBe(1);
  expect(content.b).toBe(true);
  expect(content.c).toBe('test');
});

class DiscardMessagesMockSession implements Receivable, AckSendable {
  private inputConsumer: Consumer<MessageResult>;

  public inputProducer: Producer<MessageResult>;

  public acks: { command: 'ack' | 'nack', messageId: string, transactionId: string | undefined, receiptTimeout: number }[];

  public constructor() {
    [this.inputProducer, this.inputConsumer] = createQueue();
    this.acks = [];
  }

  async receive(): Promise<MessageResult> {
    const iterator = this.inputConsumer[Symbol.asyncIterator]();

    const result = await iterator.next();

    if (result.done) {
      return fail(new Error('subscription terminated'));
    }

    return result.value;
  }

  ack(messageId: string, transactionId: string | undefined, receiptTimeout: number): Promise<SendResult> {
    this.acks.push({ command: 'ack', messageId, transactionId, receiptTimeout });
    return Promise.resolve(undefined);
  }

  nack(messageId: string, transactionId: string | undefined, receiptTimeout: number): Promise<SendResult> {
    this.acks.push({ command: 'nack', messageId, transactionId, receiptTimeout });
    return Promise.resolve(undefined);
  }
}

test('discardMessages', async () => {
  const session = new DiscardMessagesMockSession();

  const subscription = {
    id: '1',
    headers: FrameHeaders.fromMap({
      destination: '/queue/test',
      ack: 'client-individual'
    })
  };

  const message = (id: string) => ({
    command: 'MESSAGE', headers: FrameHeaders.fromMap({
      'subscription': '1',
      'destination': '/queue/test',
      'message-id': id
    }), body: writeString(id)
  });

  const finishDiscardingMessages = discardMessages('ack', subscription, session);

  session.inputProducer.push(ok(message('1')));
  session.inputProducer.push(ok(message('2')));
  session.inputProducer.push(ok(message('3')));

  session.inputProducer.push(fail(new Error('session timeout')));

  await finishDiscardingMessages;

  expect(session.acks.length).toBe(3);
  expect(session.acks[0].command).toBe('ack');
  expect(session.acks[0].messageId).toBe('1');
  expect(session.acks[0].transactionId).toBeUndefined();
  expect(session.acks[0].receiptTimeout).toBe(RECEIPT_DEFAULT_TIMEOUT);
});
