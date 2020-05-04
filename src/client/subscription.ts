import { Result, fail, success } from '../result';
import { Receivable, Subscription } from './session';
import { FrameHeaders } from '../frame/header';
import { FrameBody } from '../frame/protocol';

type Message<T> = {headers: FrameHeaders, data: T};

export function messageQueue<T>(session: Receivable, subscription: Subscription, readBody: (body: FrameBody) => Promise<Result<T>>) {

  let error: Error | undefined;

  const queue: Message<T>[] = [];
  const consumers: ((message: Result<Message<T>>) => void)[] = [];

  const dequeue = () => {
    while ((queue.length > 0 || undefined !== error) && consumers.length > 0) {

      const consumer = consumers.shift();

      if (!consumer) continue;

      if (!error) {

        const message = queue.shift();

        if (message) {
          consumer(success(message));
        }
      }
      else {
        consumer(fail(error));
      }
    }
  };

  const receiveLoop = async () => {
    
    const result = await session.receive(subscription);

    if (result.error) {
      error = result.error;
      dequeue();
      return;
    }

    const message = result.value;

    const headers = message.headers;
    const data = await readBody(message.body);

    if (data.error) {
      error = data.error;
      dequeue();
      return;
    }

    queue.push({headers, data: data.value});

    dequeue();

    receiveLoop();
  };

  receiveLoop();

  return (): Promise<Result<Message<T>>> => {
    return new Promise((resolve) => {
      consumers.push(resolve);
      dequeue();
    });
  };
}
