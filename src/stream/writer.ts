import { VoidResult } from '../result';
import { Chunk } from './chunk';

export interface Writer {
  write(chunk: Chunk): Promise<VoidResult>;
}
