
export interface SuccessResult<T> {
  error: undefined;
  cancelled: false;
  value: T;
};

export interface CancelResult {
  error: undefined;
  cancelled: true;
};

export interface FailResult<E> {
  error: E;
};

export type Result<T, E = Error> = SuccessResult<T> | FailResult<E>;

/**
 * Construct a success result
 */
export function success<T>(value: T): SuccessResult<T> {
  return {value, cancelled: false, error: undefined};
}

export function cancel(): CancelResult {
  return {cancelled: true, error: undefined};
}

/**
 * Construct a fail result
 */
export function fail<ErrorType>(error: ErrorType): FailResult<ErrorType> {
  return {error};
}

export type VoidResult<E = Error> = undefined | E;
