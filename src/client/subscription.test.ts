import { ok, fail, failed, error, result } from '../result';
import { FrameHeaders } from '../frame/header';
import { writeString, readString } from '../frame/body';
import { Receivable, MessageResult, Subscription } from './session';
import { messageQueue } from './subscription';

class MockSession implements Receivable {

  private queue: MessageResult[];
  private consumer: ((result: MessageResult) => void) | undefined;

  public calls: Subscription[];

  public constructor() {
    this.queue = [];
    this.calls = [];
  }

  public push(result: MessageResult) {
    this.queue.push(result);
    this.dequeue();
  }

  private dequeue() {
    
    if (this.queue.length === 0 || !this.consumer) {
      return;
    }

    const result = this.queue.shift();

    if (!result) {
      return;
    }

    const consumer = this.consumer;

    this.consumer = undefined;

    consumer(result);
  }

  public receive(subscription: Subscription): Promise<MessageResult> {

    this.calls.push(subscription);
    
    return new Promise((resolve) => {
      this.consumer = resolve;
      this.dequeue();
    });
  }
};

function message(content: string) {
  return ok({
    command: 'MESSAGE',
    headers: new FrameHeaders([
    ]),
    body: writeString(content)
  });
}

function createSubscription(id: string = '1', destination: string = '/queue/a', ack: string = 'auto') {
  return {
    id,
    headers: new FrameHeaders([
      ['id', id],
      ['destination', destination],
      ['ack', ack]
    ])
  };
}

describe('messageQueue', () => {

  test('consecutive receives', async () => {

    const session = new MockSession();

    session.push(message('one'));
    session.push(message('two'));
    
    const subscription = createSubscription();

    const receive = messageQueue(session, subscription, readString);

    const message1 = result(await receive());

    expect(message1.data).toBe('one');

    const message2 = result(await receive());

    expect(message2.data).toBe('two');
  });

  test('receive fail', async () => {

    const session = new MockSession();

    session.push(fail(new Error('session disconnected')));

    const subscription = createSubscription();

    const receive = messageQueue(session, subscription, readString);

    const result1 = await receive();

    expect(failed(result1) && error(result1).message).toBe('session disconnected');

    const result2 = await receive();

    expect(failed(result2) && error(result2).message).toBe('session disconnected');
  });
});
