import { Result, CancelResult, ok, failed, RESULT_OK } from '../result';
import { Receivable, Subscription } from './session';
import { FrameHeaders } from '../frame/header';
import { FrameBody } from '../frame/protocol';

type Message<T> = {headers: FrameHeaders, data: T};

export function messageQueue<T>(session: Receivable, subscription: Subscription, readBody: (body: FrameBody) => Promise<Result<T>>) {

  let terminatedResult: Result<Message<T>> | undefined;

  const queue: Message<T>[] = [];
  const consumers: ((message: Result<Message<T>> | CancelResult) => void)[] = [];

  const dequeue = () => {

    while (queue.length > 0 && consumers.length > 0) {

      const consumer = consumers.shift();

      if (!consumer) continue;

      const message = queue.shift();

      if (message) {
        consumer(ok(message));
      }
    }

    if (undefined !== terminatedResult && consumers.length > 0) {

      while (consumers.length > 0) {
        const consumer = consumers.shift();
        if (!consumer) continue;
        consumer(terminatedResult);
      }
    }
  };

  const receiveLoop = async () => {
    
    const result = await session.receive(subscription);

    if (result.status !== RESULT_OK) {
      terminatedResult = result;
      dequeue();
      return;
    }

    const message = result.value;

    const headers = message.headers;

    const readBodyResult = await readBody(message.body);

    if (failed(readBodyResult)) {
      terminatedResult = readBodyResult;
      dequeue();
      return;
    }

    queue.push({headers, data: readBodyResult.value});

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
