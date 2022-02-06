/**
 * @hidden
 */

/**
 * @hidden
 */
export type SignalEmitter<T> = (result: T) => void;

/**
 * @hidden
 */
export type Signal<T> = [Promise<T>, SignalEmitter<T>];

/**
 *  @hidden
 */
export function createSignal<T>(): Signal<T> {
  let emitter: (result: T) => void;

  const value = new Promise<T>((resolve) => {
    emitter = resolve;
  });

  return [value, (result: T) => {
    emitter(result);
  }];
}
