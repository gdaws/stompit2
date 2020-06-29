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

    for await(const value of consumer) {
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

  for await(const value of consumer) {
    expect(value).toBe(counter);
    counter += 1;
  }

  await finishPushes;
});

