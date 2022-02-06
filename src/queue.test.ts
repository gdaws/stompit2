import { createQueue } from './queue';

test('pull bound', async () => {
  const [producer, consumer] = createQueue<number>();

  producer.push(1);
  producer.push(2);
  producer.push(3);
  producer.terminate();

  let counter = 1;

  for await (const value of consumer) {
    expect(value).toBe(counter);
    counter += 1;
  }
});

test('push bound', async () => {
  const [producer, consumer] = createQueue<number>();

  const finishPulls = (async () => {
    let counter = 1;

    for await (const value of consumer) {
      expect(value).toBe(counter);
      counter += 1;
    }
  })();

  producer.push(1);
  producer.push(2);
  producer.push(3);
  producer.terminate();

  await finishPulls;
});

test('call consumers on terminate', async () => {
  const [producer, consumer] = createQueue<number>();

  const pullIterator = consumer[Symbol.asyncIterator]();

  const pull = pullIterator.next();

  producer.terminate();

  const pullResult = await pull;

  expect(pullResult.done).toBe(true);
});

test('drain', async () => {
  const [producer, consumer] = createQueue<number>();

  const finishPushes = (async () => {
    producer.push(1);
    producer.push(2);

    await producer.drained();

    producer.push(3);

    await producer.drained();

    producer.terminate();
  })();

  let counter = 1;

  for await (const value of consumer) {
    expect(value).toBe(counter);
    counter += 1;
  }

  await finishPushes;
});

test('drain on terminate', async () => {
  const [producer, _consumer] = createQueue<number>();

  const drain = producer.drained();

  producer.push(1);
  producer.terminate();

  await drain;
});

test('raise', async () => {
  const [producer, consumer] = createQueue<number>();

  const pullIterator = consumer[Symbol.asyncIterator]();
  const pull = pullIterator.next();

  producer.raise(new Error('test'));

  try {
    await pull;
    expect(true).toBe(false);
  }
  catch (e) {
    expect((e as Error).message).toBe('test');
  }
});

test('consume after raise', async () => {
  const [producer, consumer] = createQueue<number>();

  producer.raise(new Error('test'));

  const pullIterator = consumer[Symbol.asyncIterator]();
  const pull = pullIterator.next();

  try {
    await pull;
    expect(true).toBe(false);
  }
  catch (e) {
    expect((e as Error).message).toBe('test');
  }
});
