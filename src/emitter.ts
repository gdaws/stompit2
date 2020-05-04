/**
 * @hidden
 */

/**
 * @hidden
 */
export type Emitter<T> = (result: T) => void;

/**
 *  @hidden
 */
export function createEmitter<T>(): [Promise<T>, Emitter<T>] {

  let emitter: (result: T) => void;

  const slot = new Promise<T>((resolve) => {
    emitter = resolve;
  });

  return [slot, (result: T) => {
    emitter(result);
  }];
}
