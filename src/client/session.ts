import {
  Frame,
  AckMode,
  ProtocolVersion
} from '../frame/protocol';

import { FrameHeaders } from '../frame/header';
import { readServerError } from '../frame/error';

import {
  ok,
  cancel,
  fail,
  failed,
  error,
  Result,
  VoidResult,
  CancelResult
} from '../result';

import { Transport } from '../transport';

import {
  readEmptyBody,
  createEmitEndDecorator,
  writeEmptyBody
} from '../frame/body';

/**
 * @hidden
 */
import { createSignal } from '../concurrency';

export type SendResult = VoidResult;

type SendFrameCallback = (result: SendResult) => void;
type SendFrameRequest = [Frame, number, SendFrameCallback];

export type MessageResult = Result<Frame> | CancelResult;

type MessageCallback = (result: MessageResult) => void;

import { RECEIPT_NOT_REQUESTED, RECEIPT_DEFAULT_TIMEOUT } from './receipt';
import { StompitError } from '../error';

const ERROR_DISCONNECTED = 'session disconnected';
const ERROR_RECEIPT_TIMEOUT = 'receipt timeout';

interface ReceiptRequest {
  id: string;
  seq: number;
  frame: Frame;
  callback: SendFrameCallback;
  timeout: NodeJS.Timeout;
}

/**
 * The base class for a session resource
 */
export interface Resource {

  /**
   * The resource identifier
   */
  readonly id: string;

  /**
   * The frame headers used in the opening request
   */
  readonly headers: FrameHeaders;
}

/**
 * Represents an open subscription
 */
export type Subscription = Resource;

/**
 *  Represents a pending transaction
 */
export type Transaction = Resource;

export interface Receivable {
  receive(subscription: Subscription): Promise<MessageResult>;
}

export interface AckSendable {
  ack(messageId: string, transactionId: string | undefined, receiptTimeout: number): Promise<SendResult>;
  nack(messageId: string, transactionId: string | undefined, receiptTimeout: number): Promise<SendResult>;
}

export type SessionErrorListener = (error: StompitError) => void;

/**
 *
 *
 * #### Receipt Timeout Parameter
 *
 * The majority of the methods in this class, the ones which send frames to the server, have a `receiptTimeout`
 * optional parameter. This parameter sets the number of milliseconds to wait for a receipt reply from the server.
 * If a receipt is not received in time then the return value resolves to a fail result.
 *
 * As the parameter is optional, if an argument is not passed then the default value ({@link RECEIPT_DEFAULT_TIMEOUT})
 * causes the method to call on the transport object for a timeout value, in which the transport object will probably
 * return {@link RECEIPT_NOT_REQUESTED}. However for a `DISCONNECT` and `UNSUBSCRIBE` frame the transport object
 * shoulld to specify a millisecond timeout value.
 *
 * If a receipt is not required then pass {@link RECEIPT_NOT_REQUESTED}
 *
 */
export class ClientSession implements Receivable, AckSendable {
  private transport: Transport;

  private disconnected: boolean;

  private terminateCalled: boolean;

  private protocolVersion: ProtocolVersion;

  private sendQueue: SendFrameRequest[];
  private sendLoopRunning: boolean;

  private receiveFrameRequests: number;
  private receiveLoopRunning: boolean;

  private subscriptions: Set<string>;

  private messageRequests: { [subscriptionId: string]: MessageCallback };
  private unhandledMessage: Frame | undefined;

  private receiptRequests: { [receiptId: string]: ReceiptRequest };

  private nextResourceId: number;
  private nextReceiptSeq: number;

  private errorListener: SessionErrorListener | undefined;

  /**
   *
   * This constructor is for internal use. Instead use the {@link connect} function to create a ClientSession
   * object.
   *
   * You can use this constructor to create a ClientSession object to make use of a pre-existing session or a new
   * session where implicit connect is assumed.
   *
   * @param transport The connected transport
   * @param protocolVersion The protocol version negotiated with the server
   */
  public constructor(transport: Transport, protocolVersion: ProtocolVersion) {
    this.transport = transport;

    this.disconnected = false;

    this.terminateCalled = false;

    this.protocolVersion = protocolVersion;

    this.sendQueue = [];

    this.sendLoopRunning = false;
    this.receiveLoopRunning = false;

    this.subscriptions = new Set();

    this.receiveFrameRequests = 0;

    this.messageRequests = {};
    this.receiptRequests = {};

    this.nextResourceId = 1;
    this.nextReceiptSeq = 1;
  }

  /**
   * Returns the protocol version in use
   */
  public getProtocolVersion(): ProtocolVersion {
    return this.protocolVersion;
  }

  public setErrorListener(callback: SessionErrorListener) {
    this.errorListener = callback;
  }

  /**
   * Returns `true` if the session is disconnected
   */
  public isDisconnected(): boolean {
    return this.disconnected;
  }

  /**
   * Returns an unassigned resource identifier unique to the session.
   */
  public generateResourceId(): string {
    return '' + this.nextResourceId++;
  }

  /**
   * Start a transaction.
   *
   * @param receiptTimeout See the {@link ClientSession} class description for information about this parameter
   */
  public async begin(receiptTimeout: number = RECEIPT_DEFAULT_TIMEOUT): Promise<Result<Transaction>> {
    const id = this.generateResourceId();

    const headers = new FrameHeaders([
      ['transaction', id]
    ]);

    const sendError = await this.send({
      command: 'BEGIN',
      headers,
      body: writeEmptyBody()
    }, receiptTimeout);

    if (sendError) {
      return fail(sendError);
    }

    return ok({ id, headers });
  }

  /**
   * Commit a transaction
   *
   * @param transaction The transaction object or the transaction id
   * @param receiptTimeout See the {@link ClientSession} class description for information about this parameter
   */
  public commit(transaction: Transaction | string, receiptTimeout: number = RECEIPT_DEFAULT_TIMEOUT): Promise<SendResult> {
    return this.send({
      command: 'COMMIT',
      headers: new FrameHeaders([
        ['transaction', typeof transaction == 'string' ? transaction : transaction.id]
      ]),
      body: writeEmptyBody()
    }, receiptTimeout);
  }

  /**
   * Abort a transaction.
   *
   * @param transaction The transaction object or the transaction id
   * @param receiptTimeout See the {@link ClientSession} class description for information about this parameter
   */
  public abort(transaction: Transaction | string, receiptTimeout: number = RECEIPT_DEFAULT_TIMEOUT): Promise<SendResult> {
    return this.send({
      command: 'ABORT',
      headers: new FrameHeaders([
        ['transaction', typeof transaction == 'string' ? transaction : transaction.id]
      ]),
      body: writeEmptyBody()
    }, receiptTimeout);
  }

  /**
   * Open a subscription to receive messages.
   *
   * The subscription holder is obliged to maintain a recurring receive operation. If the server sends a message and
   * there is no related pending receive operation then the session will shutdown.
   *
   * @param destination The message location
   * @param ack The acknowledgement mode of the subscription
   * @param receiptTimeout See the {@link ClientSession} class description for information about this parameter
   */
  public async subscribe(destination: string, ack: AckMode = 'auto', receiptTimeout: number = RECEIPT_DEFAULT_TIMEOUT): Promise<Result<Subscription>> {
    const id = this.generateResourceId();

    const headers = new FrameHeaders([
      ['id', id],
      ['destination', destination],
      ['ack', ack !== 'auto' ? ack : undefined]
    ]);

    const sendError = await this.send({
      command: 'SUBSCRIBE',
      headers,
      body: writeEmptyBody()
    }, receiptTimeout);

    if (sendError) {
      return fail(sendError);
    }

    return ok({ id, headers });
  }

  /**
   * Close a subscription. If there is a pending receive operation on the subscription then it is cancelled.
   *
   * @param subscription
   * @param receiptTimeout See the {@link ClientSession} class description for information about this parameter
   */
  public unsubscribe(subscription: Subscription, receiptTimeout: number = RECEIPT_DEFAULT_TIMEOUT): Promise<SendResult> {
    return this.send({
      command: 'UNSUBSCRIBE',
      headers: new FrameHeaders([
        ['id', subscription.id]
      ]),
      body: writeEmptyBody()
    }, receiptTimeout);
  }

  /**
   * Receive a message.
   *
   * Only one concurrent receive operation is permitted per subscription.
   *
   * @param subscription The subscription to receive the message from
   * @return The received message frame
   *
   * The headers will contain a `destination` and `message-id` header.
   *
   * If the subscription requires explicit acknowledgment then you must call one of the ack methods.
   *
   * To acknowledge to the server that the message was successfully consumed, call the `ack` method e.g:
   *
   * ```javascript
   * await session.ack(message.headers.get('message-id')));
   * ```
   *
   * On the other hand if the message was not consumed then call the `nack` method e.g:
   *
   * ```javascript
   * await session.nack(message.headers.get('message-id')));
   * ```
   */
  public receive(subscription: Subscription): Promise<MessageResult> {
    return new Promise((resolve) => {
      const id = subscription.id;

      if (this.unhandledMessage && this.unhandledMessage.headers.get('subscription') === id) {
        const message = this.unhandledMessage;
        this.unhandledMessage = undefined;
        resolve(ok(message));
        return;
      }

      if (this.messageRequests.hasOwnProperty(id)) {
        this.messageRequests[id](cancel());
        this.receiveFrameRequests -= 1;
      }

      this.messageRequests[id] = resolve;

      this.addReceiveRequest();
    });
  }

  /**
   * Cancel a pending receive message operation.
   *
   * @param subscription
   */
  public cancelReceive(subscription: Subscription): void {
    const id = subscription.id;

    if (!this.messageRequests.hasOwnProperty(id)) {
      return;
    }

    const request = this.messageRequests[id];

    delete this.messageRequests[id];

    request(cancel());
  }

  /**
   * Send an acknowledgement to the server to indicate the consumption of a message.
   *
   * @param messageId The identifier of the received message. This value is obtained from the `message-id` header.
   * @param transactionId Specify that this frame is part of a transaction
   * @param receiptTimeout See the {@link ClientSession} class description for information about this parameter
   */
  public ack(messageId: string, transactionId: string | undefined = undefined, receiptTimeout: number = RECEIPT_DEFAULT_TIMEOUT): Promise<SendResult> {
    return this.send({
      command: 'ACK',
      headers: FrameHeaders.fromMap({
        id: messageId,
        transaction: transactionId
      }),
      body: writeEmptyBody()
    }, receiptTimeout);
  }

  /**
   * Send a negative acknowledgement to the server to indicate that the message cannot be consumed.
   *
   * @param messageId The identifier of the received message. This value is obtained from the `message-id` header.
   * @param transactionId Specify that this frame is part of a transaction
   * @param receiptTimeout See the {@link ClientSession} class description for information about this parameter
   */
  public nack(messageId: string, transactionId: string | undefined = undefined, receiptTimeout: number = RECEIPT_DEFAULT_TIMEOUT): Promise<SendResult> {
    return this.send({
      command: 'NACK',
      headers: FrameHeaders.fromMap({
        id: messageId,
        transaction: transactionId
      }),
      body: writeEmptyBody()
    }, receiptTimeout);
  }

  /**
   * Initiate a graceful shutdown of the session. As soon as the DISCONNECT frame is ready to be sent the session
   * enters the disconnected state, however any pending operations will remain until the disconnect request
   * completes. Once the receipt for the disconnect is received the request is completed and then the session
   * starts the shutdown procedure. The underlying transport is closed and any remaining pending send and receive
   * operations are cancelled.
   *
   * If `RECEIPT_NOT_REQUESTED` is passed then the disconnect request completes immediately after the transport
   * `writeFrame` method call completes.
   *
   * If a receipt was requested and the timeout is reached then the session is forcefully shutdown and the return
   * value resolves to a fail result.
   *
   * The return value is a success or fail result.
   */
  public disconnect(receiptTimeout: number = RECEIPT_DEFAULT_TIMEOUT): Promise<SendResult> {
    return this.send({
      command: 'DISCONNECT',
      headers: new FrameHeaders(),
      body: writeEmptyBody()
    }, receiptTimeout);
  }

  /**
   * Invoke an abrupt shutdown of the session. The intention to close the session is not communicated with the
   * server. The underlying transport is closed and all pending send and receive operations are cancelled. There is a
   * risk of messages and acknowledgements being undelivered.
   *
   * The recommended method for closing a session is {@link disconnect}.
   */
  public shutdown() {
    const operationCancelled = new StompitError('OperationCancelled', 'shutdown called');

    this.closeSendRequests(operationCancelled);
    this.closeReceiveRequests(operationCancelled);

    this.terminate();
  }

  private terminate() {
    if (this.terminateCalled) {
      return;
    }

    this.terminateCalled = true;

    this.disconnected = true;

    if (this.sendQueue.length > 0 || this.receiveFrameRequests > 0) {
      const sessionClosed = new StompitError('SessionClosed', 'session closed');

      this.closeSendRequests(sessionClosed);
      this.closeReceiveRequests(sessionClosed);
    }

    this.transport.close();
  }

  /**
   * Send a frame to the server.
   *
   * @param frame The outbound frame
   * @param receiptTimeout See the {@link ClientSession} class description for information about this parameter
   */
  public send(frame: Frame, receiptTimeout: number = RECEIPT_DEFAULT_TIMEOUT): Promise<SendResult> {
    const requiredHeaders: { [command: string]: string[] } = {
      'SEND': ['destination'],
      'SUBSCRIBE': ['destination', 'id'],
      'UNSUBSCRIBE': ['id'],
      'ACK': ['id'],
      'NACK': ['id'],
      'BEGIN': ['transaction'],
      'COMMIT': ['transaction']
    };

    const missingHeader = frame.headers.required(...(requiredHeaders[frame.command] || []));

    if (missingHeader) {
      return Promise.reject(missingHeader);
    }

    if (frame.command === 'DISCONNECT' && receiptTimeout === RECEIPT_NOT_REQUESTED) {
      return Promise.reject(new Error('sending a disconnect request must include a receipt timeout'));
    }

    return new Promise((resolve) => {
      if (!this.sendLoopRunning) {
        this.sendLoopRunning = true;
        this.sendLoop(frame, receiptTimeout, resolve);
      }
      else {
        this.sendQueue.push([frame, receiptTimeout, resolve]);
      }
    });
  }

  private sendLoop(framePrototype: Frame, receiptTimeout: number, callback: SendFrameCallback) {
    if (this.disconnected) {
      callback(new StompitError('TransportFailure', ERROR_DISCONNECTED));

      this.sendLoopRunning = false;
      return;
    }

    const frame = { ...framePrototype };

    if (RECEIPT_DEFAULT_TIMEOUT === receiptTimeout) {
      const transportReceiptTimeout = this.transport.getReceiptTimeout(frame);
      receiptTimeout = transportReceiptTimeout >= 0 ? transportReceiptTimeout : RECEIPT_NOT_REQUESTED;
    }

    if (RECEIPT_NOT_REQUESTED !== receiptTimeout) {
      const receiptId = this.generateResourceId();

      frame.headers = FrameHeaders.merge(frame.headers, new FrameHeaders([
        ['receipt', receiptId]
      ]));

      this.receiptRequests[receiptId] = {
        id: receiptId,
        seq: this.nextReceiptSeq++,
        frame,
        callback,
        timeout: setTimeout(() => {
          const request = this.receiptRequests[receiptId];

          if (!request) {
            return;
          }

          delete this.receiptRequests[receiptId];

          const error = new StompitError('OperationTimeout', ERROR_RECEIPT_TIMEOUT);

          request.callback(error);
        }, receiptTimeout)
      };

      this.addReceiveRequest();
    }

    if ('DISCONNECT' === frame.command) {
      this.disconnected = true;
    }

    this.transport.writeFrame(frame, this.protocolVersion).then((error) => {
      if (error) {
        if (RECEIPT_NOT_REQUESTED !== receiptTimeout) {
          const receiptId = frame.headers.get('receipt');
          if (receiptId) {
            const receiptRequest = this.receiptRequests[receiptId];
            if (receiptRequest) {
              clearTimeout(receiptRequest.timeout);
              delete this.receiptRequests[receiptId];
            }
          }
        }

        callback(error);

        this.notifyErrorListener(error);
        this.terminate();

        this.sendLoopRunning = false;

        return;
      }

      if (RECEIPT_NOT_REQUESTED === receiptTimeout) {
        this.observeSendCompletion(frame);
        callback(undefined);
      }

      // If a receipt was requested then send completion will occur in the RECEIPT receive handler

      if (0 === this.sendQueue.length) {
        this.sendLoopRunning = false;
      }
      else {
        const nextRequest = this.sendQueue.shift();
        if (nextRequest) {
          return this.sendLoop(...nextRequest);
        }
      }
    });
  }

  private addReceiveRequest() {
    this.receiveFrameRequests += 1;

    if (!this.receiveLoopRunning) {
      this.receiveLoopRunning = true;

      (async () => {
        while (this.receiveFrameRequests > 0) {
          await this.receiveLoop();
        }

        this.receiveLoopRunning = false;
      })();
    }
  }

  private async receiveLoop(): Promise<void> {
    const readFrameResult = await this.transport.readFrame(this.protocolVersion);

    if (failed(readFrameResult)) {
      this.notifyErrorListener(error(readFrameResult));
      return this.terminate();
    }

    const frame = readFrameResult.value;

    switch (frame.command) {
      case 'MESSAGE': {
        const [readEndObserved, emitReadEnd] = createSignal<Error | void>();
        const decoratedBody = createEmitEndDecorator(frame.body, emitReadEnd);

        const subscriptionId = frame.headers.get('subscription');

        if (!subscriptionId) {
          const error = new StompitError('ProtocolViolation', 'server sent MESSAGE frame without including a subscription header');
          this.notifyErrorListener(error);
          return this.terminate();
        }

        const callback = this.messageRequests[subscriptionId];

        const message = {
          ...frame,
          body: decoratedBody
        };

        if (callback) {
          delete this.messageRequests[subscriptionId];

          callback(ok(message));
        }
        else {
          const id = message.headers.get('subscription');
          if (id && this.subscriptions.has(id)) {
            this.unhandledMessage = message;
          }
          else {
            const error = new StompitError('ProtocolViolation', 'unhandled message');
            this.notifyErrorListener(error);
            return this.terminate();
          }
        }

        await readEndObserved;

        this.receiveFrameRequests -= 1;

        break;
      }

      case 'RECEIPT': {
        const readBodyResult = await readEmptyBody(frame.body);

        if (failed(readBodyResult)) {
          this.notifyErrorListener(error(readBodyResult));
          return this.terminate();
        }

        const receiptId = frame.headers.get('receipt-id');

        if (!receiptId) {
          const error = new StompitError('ProtocolViolation', 'server sent RECEIPT frame without a receipt-id header');
          this.notifyErrorListener(error);
          return this.terminate();
        }

        this.receiveFrameRequests -= 1;

        this.processReceipt(receiptId);

        break;
      }

      case 'ERROR':
        const serverError = await readServerError(frame);
        this.notifyErrorListener(serverError);
        return this.terminate();
    }
  }

  private processReceipt(id: string) {
    const latestRequest = this.receiptRequests[id];

    if (!latestRequest) {
      return false;
    }

    const latestSeq = latestRequest.seq;

    Object
      .values(this.receiptRequests)
      .filter(request => request.seq <= latestSeq)
      .sort((a, b) => a.seq - b.seq)
      .forEach(request => {
        clearTimeout(request.timeout);

        delete this.receiptRequests[request.id];

        this.observeSendCompletion(request.frame);

        request.callback(undefined);
      })

    return true;
  }

  private notifyErrorListener(error: StompitError) {
    if (this.errorListener) {
      this.errorListener(error);
    }
  }

  private closeSendRequests(error: StompitError) {
    this.sendQueue.forEach(([_frame, _timeout, callback]) => {
      callback(error);
    });

    this.sendQueue = [];
  }

  private closeReceiveRequests(error: StompitError) {
    this.subscriptions.clear();

    const receiptRequests = this.receiptRequests;
    const messageRequests = this.messageRequests;

    this.receiveFrameRequests = 0;

    this.messageRequests = {};
    this.receiptRequests = {};

    Object.values(receiptRequests).forEach(request => {
      clearTimeout(request.timeout);
      request.callback(error);
    });

    Object.values(messageRequests).forEach(callback => {
      if (error.code === 'OperationCancelled') {
        callback(cancel());
      }
      else callback(fail(error))
    });
  }

  private observeSendCompletion(frame: Frame) {
    switch (frame.command) {
      case 'DISCONNECT':

        Object.values(this.receiptRequests).forEach(request => {
          clearTimeout(request.timeout);
          request.callback(undefined);
        });

        this.receiptRequests = {};

        const operationCancelled = new StompitError('OperationCancelled', 'session closed');

        this.closeSendRequests(operationCancelled);
        this.closeReceiveRequests(operationCancelled);

        this.shutdown();

        break;

      case 'SUBSCRIBE': {
        const id = frame.headers.get('id');

        if (!id) {
          break;
        }

        this.subscriptions.add(id);

        break;
      }

      case 'UNSUBSCRIBE': {
        const id = frame.headers.get('id');

        if (!id) {
          break;
        }

        this.subscriptions.delete(id);

        if (this.messageRequests.hasOwnProperty(id)) {
          const callback = this.messageRequests[id];

          callback(cancel());

          delete this.messageRequests[id];
        }

        break;
      }
    }
  }
}
