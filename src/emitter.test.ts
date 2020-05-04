import { createEmitter } from './emitter';

test('emitter', async () => {

  const [signal, emit] = createEmitter<string>();

  setImmediate(() => {
    emit('test');
  });

  const value = await signal;

  expect(value).toBe('test');
});
