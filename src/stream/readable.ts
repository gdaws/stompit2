import { Readable } from 'stream';
import { ChunkStream } from './chunk';

export async function* streamFromReadable(readable: Readable): ChunkStream {

  for await (const chunk of readable) {

    if (!(chunk instanceof Buffer)) {
      throw new Error('expected chunk from readable to be Buffer type');
    }

    yield chunk;
  }
}
