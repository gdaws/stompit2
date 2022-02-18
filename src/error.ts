import { Frame } from './frame/protocol';
import { FrameHeaders } from './frame/header';

export interface LoadedErrorFrame {
  command: 'ERROR';
  headers: FrameHeaders;
  body: string;
}

export function isLoadedErrorFrame(frame: Omit<Frame, 'body'> & { body: string }): frame is LoadedErrorFrame {
  return frame.command === 'ERROR';
}

export type ErrorCode =
  'OperationCancelled' |
  'OperationTimeout' |
  'OperationError' |
  'SessionClosed' |
  'ServerError' |
  'ProtocolViolation' |
  'TransportFailure'
  ;

export class StompitError extends Error {
  public readonly code: ErrorCode;

  public constructor(code: ErrorCode, message: string | undefined) {
    super(message);
    this.code = code;
  }
}

export function isStompitError(error: any): error is StompitError {
  return error instanceof StompitError;
}

export class ServerError extends StompitError {
  public readonly frame: LoadedErrorFrame;

  public constructor(frame: LoadedErrorFrame, message: string) {
    super('ServerError', message);
    this.frame = frame;
  }
}

export function isServerError(error: StompitError): error is ServerError {
  return error.code == 'ServerError' && (error as any).frame;
}
