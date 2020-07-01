import { createSignal, Signal } from './concurrency';

export interface Producer<T> {
  push: (value: T) => boolean;
  drained: () => Promise<void>;
  terminate: () => void;
  raise: (error: Error) => void;
};

export type Consumer<T> = AsyncIterable<T>;

type ConsumerController<T> = [(value: IteratorResult<T>) => void, (error: any) => void];

export type Queue<T> = [Producer<T>, Consumer<T>];

export function createQueue<T>(): Queue<T> {

  let terminated = false;
  let thrown: Error | undefined;

  const queue: T[] = [];

  const consumers: ConsumerController<T>[] = [];

  let drainEvent: Signal<void> | undefined;

  const push = (value: T) => {

    if (consumers.length === 0) {
      queue.push(value);
      return false;
    }

    while (consumers.length > 0) {
      const consumer = consumers.shift();
      if (consumer) {
        const [resolve] = consumer;
        resolve({value, done: false});
      }
      else {
        throw new Error('Logic error: shift on a non-empty Array<ConsumerController<T>> returned undefined');
      }
    }

    return true;
  };

  const drained = () => {

    if (queue.length === 0) {
      return Promise.resolve();
    }

    if (!drainEvent) {
      drainEvent = createSignal();
    }

    return drainEvent[0];
  }

  const terminate = () => {
    
    terminated = true;

    while (consumers.length > 0) {
      const consumer = consumers.shift();
      if (consumer) {
        const [resolve] = consumer;
        resolve({value: undefined, done: true});
      }
    }

    if (drainEvent) {
      drainEvent[1]();
      drainEvent = undefined;
    }
  };

  const raise = (error: Error) => {

    thrown = error;

    while (consumers.length > 0) {
      const consumer = consumers.shift();
      if (consumer) {
        const [_, reject] = consumer;
        reject(error);
      }
    }

    if (drainEvent) {
      drainEvent[1]();
      drainEvent = undefined;
    }
  };

  const consume = () => new Promise<IteratorResult<T>>((resolve, reject) => {

    if (queue.length > 0) {

      if (drainEvent && queue.length === 1) {
        drainEvent[1]();
        drainEvent = undefined;
      }

      const value = queue.shift();

      if (value) {
        resolve({value, done: false});
        return;
      }
      else {
        reject(new Error('non-empty queue shift returned undefined'));
        return;
      }
    }

    if (thrown) {
      reject(thrown);
      return;
    }

    if (terminated) {
      resolve({value: undefined, done: true});
      return;
    }

    consumers.push([resolve, reject]);
  });

  const createAsyncIterator = () => {
    return {
      [Symbol.asyncIterator]: createAsyncIterator,
      next: consume
    };
  };

  return [{push, drained, raise, terminate}, createAsyncIterator()];
}