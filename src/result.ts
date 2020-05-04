
export interface SuccessResult<T> {
  error: undefined;
  value: T;
};

export interface FailResult<E> {
  error: E;
};

export type Result<T, E = Error> = SuccessResult<T> | FailResult<E>;

/**
 * Construct a success result
 */
export function success<T>(value: T): SuccessResult<T> {
  return {value, error: undefined};
};

/**
 * Construct a fail result
 */
export function fail<ErrorType>(error: ErrorType): FailResult<ErrorType> {
  return {error};
};

export type VoidResult<E = Error> = undefined | E;
