import { createSignal, Signal } from './concurrency';

export interface Producer<T> {
  push: (value: T) => boolean;
  drained: () => Promise<void>;
  terminate: () => void;
  raise: (error: Error) => void;
}

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
      const [resolve] = consumers.shift() as ConsumerController<T>;
      resolve({ value, done: false });
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
        resolve({ value: undefined, done: true });
      }
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
  };

  const consume = () => new Promise<IteratorResult<T>>((resolve, reject) => {
    if (queue.length > 0) {
      const value = queue.shift() as T;

      resolve({ value, done: false });

      if (drainEvent && queue.length === 0) {
        drainEvent[1]();
        drainEvent = undefined;
      }

      return;
    }

    if (thrown) {
      reject(thrown);
      return;
    }

    if (terminated) {
      resolve({ value: undefined, done: true });
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

  return [{ push, drained, raise, terminate }, createAsyncIterator()];
}
