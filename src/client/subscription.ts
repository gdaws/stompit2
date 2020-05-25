import { Result, CancelResult, fail, success, cancel } from '../result';
import { Receivable, Subscription } from './session';
import { FrameHeaders } from '../frame/header';
import { FrameBody } from '../frame/protocol';

type Message<T> = {headers: FrameHeaders, data: T};

export function messageQueue<T>(session: Receivable, subscription: Subscription, readBody: (body: FrameBody) => Promise<Result<T>>) {

  let error: Error | undefined;
  let cancelled: boolean = false;

  const queue: Message<T>[] = [];
  const consumers: ((message: Result<Message<T>> | CancelResult) => void)[] = [];

  const dequeue = () => {

    while (queue.length > 0 && consumers.length > 0) {

      const consumer = consumers.shift();

      if (!consumer) continue;

      const message = queue.shift();

      if (message) {
        consumer(success(message));
      }
    }

    if ((error || cancelled) && consumers.length > 0) {

      while (consumers.length > 0) {

        const consumer = consumers.shift();

        if (!consumer) continue;
        
        if (error) {
          consumer(fail(error));
        }
        else {
          consumer(cancel());
        }
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

    if (result.cancelled) {
      cancelled = true;
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

  return (): Promise<Result<Message<T>> | CancelResult> => {
    return new Promise((resolve) => {
      consumers.push(resolve);
      dequeue();
    });
  };
}
