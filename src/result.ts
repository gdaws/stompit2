import { ErrorCode, StompitError } from './error';

export const RESULT_OK = 0;
export const RESULT_ERROR = 1;
export const RESULT_CANCELLED = 2;
export const RESULT_TIMEOUT = 3;

export const MESSAGE_RESULT_CANCELLED = 'operation cancelled';
export const MESSAGE_RESULT_TIMEOUT = 'operation timed out';

export interface ResultStatus {
  status: number;
}

export interface OkResult<T> extends ResultStatus {
  status: typeof RESULT_OK;
  value: T;
}

export interface ErrorResult<E> extends ResultStatus {
  status: typeof RESULT_ERROR;
  error: E;
}

export interface CancelResult extends ResultStatus {
  status: typeof RESULT_CANCELLED;
}

export interface TimeoutResult extends ResultStatus {
  status: typeof RESULT_TIMEOUT;
}

export type Result<T, E extends StompitError = StompitError> = OkResult<T> | ErrorResult<E> | CancelResult | TimeoutResult;

/**
 * Construct a success result
 */
export function ok<T>(value: T): OkResult<T> {
  return { status: RESULT_OK, value };
}

export function cancel(): CancelResult {
  return { status: RESULT_CANCELLED };
}

/**
 * Construct a fail result
 */
export function fail<ErrorType>(error: ErrorType): ErrorResult<ErrorType> {
  return { status: RESULT_ERROR, error };
}

export function errorCode(value: ErrorCode, message: string): ErrorResult<StompitError> {
  return { status: RESULT_ERROR, error: new StompitError(value, message) };
}

export function failed<T, E extends StompitError>(result: Result<T, E> | undefined): result is Exclude<Result<T, E>, OkResult<T>> {
  if (!result) {
    return false;
  }

  return result.status !== RESULT_OK;
}

export function cancelled(result: ResultStatus): result is CancelResult {
  return result.status === RESULT_CANCELLED;
}

export function error<T, E extends StompitError>(result: Exclude<Result<T, E>, OkResult<T>>): StompitError {
  if (result.status === RESULT_ERROR) {
    return result.error;
  }

  if (result.status === RESULT_CANCELLED) {
    return new StompitError('OperationCancelled', MESSAGE_RESULT_CANCELLED);
  }

  if (result.status === RESULT_TIMEOUT) {
    return new StompitError('OperationTimeout', MESSAGE_RESULT_TIMEOUT);
  }

  return new StompitError('OperationError', 'unknown status');
}

export function result<T, E extends StompitError>(result: Result<T, E>, defaultValue?: T): T {
  if (result.status == RESULT_OK) {
    return result.value;
  }

  if (undefined !== defaultValue) {
    return defaultValue;
  }

  throw error(result);
}

export type VoidResult<E = StompitError> = undefined | E;
