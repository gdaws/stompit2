import { Result, ok, fail } from '../result';
import { Chunk, ChunkStream, alloc, concatPair } from './chunk';

enum ReadStatus {
  Continued,
  Completed,
  Error
}

interface ReadOperationResult {
  readonly status: ReadStatus;
}

interface ReadContinued extends ReadOperationResult {
  readonly status: typeof ReadStatus.Continued;
}

interface ReadCompleted extends ReadOperationResult {
  readonly status: typeof ReadStatus.Completed;
  readonly consume: number;
  readonly skip: number;
}

interface ReadError extends ReadOperationResult {
  readonly status: typeof ReadStatus.Error;
  readonly error: Error;
}

const continued = (): ReadContinued => ({
  status: ReadStatus.Continued
});

const completed = (consume: number, skip: number): ReadCompleted => ({
  status: ReadStatus.Completed,
  consume,
  skip
});

type ReadOperation = (buffer: Chunk) => ReadContinued | ReadCompleted | ReadError;

export type ReadResult = Result<Chunk>;

export class Reader {
  private stream: ChunkStream;

  private buffer: Chunk;

  private running: boolean;

  public constructor(stream: ChunkStream) {
    this.stream = stream;

    this.buffer = alloc(0);

    this.running = false;
  }

  public readRange(minBytes: number, maxBytes: number): Promise<ReadResult> {
    if (minBytes < 1) {
      return Promise.resolve(fail(new Error('invalid minBytes parameter')));
    }

    if (maxBytes < minBytes) {
      return Promise.resolve(fail(new Error('invalid maxBytes parameter')));
    }

    return this.run(
      (buffer) => buffer.length >= minBytes ? completed(Math.min(buffer.length, maxBytes), 0) : continued()
    );
  }

  public read(bytes: number): Promise<ReadResult> {
    return this.readRange(bytes, bytes);
  }

  public readLine(maxLength: number): Promise<ReadResult> {
    let index = 0;

    return this.run(
      (buffer) => {
        const end = Math.min(buffer.length, maxLength);

        for (; index < end; index++) {
          if (0xA === buffer[index]) {
            const after = index + 1;

            if (index > 0 && 0xD === buffer[index - 1]) {
              index -= 1;
            }

            return completed(index, after - index);
          }
        }

        if (buffer.length > maxLength) {
          return {
            status: ReadStatus.Error,
            error: new Error('maximum line length exceeded')
          };
        }

        return continued();
      }
    );
  }

  public readUntil(magicByte: number, maxReadLength: number): Promise<ReadResult> {
    let index = 0;

    return this.run((buffer) => {
      const end = Math.min(buffer.length, maxReadLength);

      for (; index < end; index++) {
        if (buffer[index] === magicByte) {
          return completed(index + 1, 0);
        }
      }

      if (buffer.length >= maxReadLength) {
        return completed(maxReadLength, 0);
      }

      return continued();
    });
  }

  private async run(operation: ReadOperation): Promise<ReadResult> {
    if (this.running) {
      return fail(new Error('read operation already running'));
    }

    this.running = true;

    const result = await this.runProper(operation, this.buffer.length === 0);

    this.running = false;

    return result;
  }

  private async runProper(operation: ReadOperation, readStream: boolean): Promise<ReadResult> {
    let streamEnded;

    if (readStream) {
      try {
        const streamStatus = await this.stream.next();

        streamEnded = streamStatus.done;

        if (streamStatus.value) {
          this.buffer = concatPair(this.buffer, streamStatus.value);
        }
      }
      catch (error) {
        if (error instanceof Error) {
          return fail(error);
        }
        else {
          throw new Error('');
        }
      }
    }

    const result = operation(this.buffer);

    switch (result.status) {
      case ReadStatus.Continued: {
        if (streamEnded) {
          return fail(new Error('unexpected end of stream'));
        }

        return this.runProper(operation, true);
      }

      case ReadStatus.Completed: {
        const runResult = this.buffer.slice(0, result.consume);

        this.buffer = this.buffer.slice(result.consume + result.skip);

        return ok(runResult);
      }

      case ReadStatus.Error: {
        return fail(result.error);
      }
    }
  }
}
