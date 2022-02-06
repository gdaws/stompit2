import { createSignal } from './concurrency';

test('createSignal', async () => {
  const [signalValue, signal] = createSignal<string>();

  setImmediate(() => {
    signal('test');
  });

  const value = await signalValue;

  expect(value).toBe('test');
});
