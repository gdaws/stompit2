import { TextEncoder } from 'util';
import { Reader } from '../stream/reader';
import { readFrame, ReadParameters } from './input';

import { 
  STOMP_VERSION_10, 
  STOMP_VERSION_11, 
  STOMP_VERSION_12,
  Frame,
  FrameBodyChunk,
  FrameBody,
} from './protocol';

import { success } from '../result';

function reader(value: string): Reader {
  return new Reader((async function* () {
    const encoder = new TextEncoder();
    yield encoder.encode(value);
  })());
}

function neverResolve(): Promise<void> {
  return new Promise(() => {});
}

async function read(body: FrameBody): Promise<FrameBodyChunk> {

  let result = Buffer.alloc(0);

  for await (const chunk of body) {

    if (chunk.error) {
      return chunk;
    }

    result = Buffer.concat([result, chunk.value]);
  }

  return success(result);
}

async function readToString(body: FrameBody): Promise<string> {

  const result = await read(body);

  if (result.error) {
    throw new Error('expected success result from read body');
  }

  return result.value.toString();
}

async function expectEmptyBody(frame: Frame) {

  const body = await read(frame.body);

  if(body.error) {
    return;
  }

  expect(body.error).toBeUndefined();
  expect(body.value).toBeDefined();

  if (!body.value) {
    return;
  }

  expect(body.value.length).toBe(0);
}

const someReadParams: ReadParameters = {
  maxHeaderLines: 64,
  maxLineLength: 4096,
  maxBodyLength: Infinity,
  maxBodyChunkLength: 4096,
  ignoreLeadingEmptyLines: true,
  protocolVersion: STOMP_VERSION_10
};

async function parseValid(value: string, params: ReadParameters = someReadParams): Promise<Frame> {

  const readResult = await readFrame(reader(value), params);

  if (readResult.error) {
    expect(readResult.error).toBeUndefined();
    throw new Error('read error');
  }

  expect(readResult.value).toBeDefined();

  const frame = readResult.value;

  if (!frame) {
    throw new Error('expected to parse valid frame');
  }

  return frame;
}

describe('readFrame', () => {

  test('empty frame', async () => {

    const frame = await parseValid('EMPTY\n\n\x00');

    expect(frame.command).toBe('EMPTY');
    expect(Array.from(frame.headers)).toHaveLength(0);
    
    await expectEmptyBody(frame);
  });

  test('CRLF lines', async () => {

    const frame = await parseValid('EMPTY\r\n\r\n\x00');

    expect(frame.command).toBe('EMPTY');
    expect(Array.from(frame.headers)).toHaveLength(0);
    
    await expectEmptyBody(frame);
  });

  test('repeated header entries', async () => {

    const frame = await parseValid('MESSAGE\nfoo: Hello\nfoo: World\n\n\x00');

    expect(frame.headers.get('foo')).toBe(' Hello');

    const fooHeaders = frame.headers.getAll('foo');

    expect(fooHeaders[0]).toBe(' Hello');
    expect(fooHeaders[1]).toBe(' World');
  });

  test('typical connect frame', async () => {

    const frame = await parseValid('CONNECT\naccept-version:1.2\nhost:stomp.github.org\n\n\x00');

    expect(frame.command).toBe('CONNECT');
    expect(frame.headers.get('accept-version')).toBe('1.2');
    expect(frame.headers.get('host')).toBe('stomp.github.org');

    await expectEmptyBody(frame);
  });

  test('typical send frame', async () => {

    const frame = await parseValid('SEND\ndestination:/queue/a\ncontent-type:text\/plain\n\nhello queue a\n\x00');

    expect(frame.command).toBe('SEND');
    expect(frame.headers.get('destination')).toBe('/queue/a');
    expect(frame.headers.get('content-type')).toBe('text\/plain');

    const body = await readToString(frame.body);
  
    expect(body).toBe('hello queue a\n');
  });

  test('fixed size body', async () => {
    const frame = await parseValid('SEND\ncontent-length:5\n\nhello\x00');
    const body = await readToString(frame.body);
    expect(body).toBe('hello');
  });

  test('fixed size body error', async () => {
    
    const readFrameResult = await readFrame(reader('SEND\ncontent-length:5\n\n.'), someReadParams);

    if (readFrameResult.error) {
      expect(readFrameResult.error).toBeUndefined();
      return;
    }

    const frame = readFrameResult.value;

    const bodyIterator = frame.body;
    
    const bodyResult = (await bodyIterator.next()).value;
    
    if (!bodyResult) {
      expect(bodyResult).toBeDefined();
      return;
    }

    expect(bodyResult.error).toBeDefined();
  });

  test('dynamic size body read error', async () => {

    const readFrameResult = await readFrame(reader('SEND\n\n...'), someReadParams);

    if (readFrameResult.error) {
      expect(readFrameResult.error).toBeUndefined();
      return;
    }

    const frame = readFrameResult.value;

    const bodyIterator = frame.body;
    
    const first = (await bodyIterator.next()).value;

    expect(first.error).toBeDefined();
  });

  test('fixed size body error on NULL byte', async () => {

    const readFrameResult = await readFrame(reader('SEND\ncontent-length:5\n\n.....'), someReadParams);

    if (readFrameResult.error) {
      expect(readFrameResult.error).toBeUndefined();
      return;
    }

    const frame = readFrameResult.value;

    const bodyIterator = frame.body;
    
    const first = (await bodyIterator.next()).value;

    expect(first.error).toBeUndefined();

    const second = (await bodyIterator.next()).value;

    expect(second.error).toBeDefined();
  });

  test('fixed size body error no NULL byte', async () => {

    const readFrameResult = await readFrame(reader('SEND\ncontent-length:5\n\n.....A'), someReadParams);

    if (readFrameResult.error) {
      expect(readFrameResult.error).toBeUndefined();
      return;
    }

    const frame = readFrameResult.value;

    const bodyIterator = frame.body;
    
    const first = (await bodyIterator.next()).value;

    expect(first.error).toBeUndefined();

    const second = (await bodyIterator.next()).value;

    expect(second.error).toBeDefined();
  });

  test('fixed size body with a null character wihin the body', async () => {

    const frame = await parseValid('SEND\ncontent-length:3\n\n\x00\x01\x02\x00');

    const result = await read(frame.body);

    if (result.error) {
      expect(result.error).toBeUndefined();
      return;
    }

    expect(result.value).toBeDefined();    

    if (!result.value) {
      return;
    }

    const buffer = result.value;

    expect(buffer.length).toBe(3);

    expect(buffer[0]).toBe(0);
    expect(buffer[1]).toBe(1);
    expect(buffer[2]).toBe(2);
  }); 

  test('multiple frames', async () => {

    const source = reader('SEND\n\nfirst\x00SEND\n\nsecond\x00\n\nSEND\n\nthird\x00');

    const firstFrame = await readFrame(source, someReadParams);

    if (firstFrame.error) {
      expect(firstFrame.error).toBeUndefined();
      return;
    }

    expect(firstFrame.value).toBeDefined();

    if (!firstFrame.value) {
      return;
    }

    expect(await readToString(firstFrame.value.body)).toBe('first');

    const secondFrame = await readFrame(source, someReadParams);
  
    if (secondFrame.error) {
      expect(secondFrame.error).toBeUndefined();
      return;
    }

    expect(secondFrame.value).toBeDefined();

    if (!secondFrame.value) {
      return;
    }

    expect(await readToString(secondFrame.value.body)).toBe('second');
    
    const thirdFrame = await readFrame(source, someReadParams);
  
    if (thirdFrame.error) {
      expect(thirdFrame.error).toBeUndefined();
      return;
    }

    expect(thirdFrame.value).toBeDefined();

    if (!thirdFrame.value) {
      return;
    }

    expect(await readToString(thirdFrame.value.body)).toBe('third');
  });

  

  test('value decoding in protocol version 1.0', async () => {

    const first = await parseValid('SEND\na:b:\\n\\c\n\n\n\x00', {...someReadParams, protocolVersion: STOMP_VERSION_10});

    expect(first.headers.get('a')).toBe('b:\\n\\c');
  });

  test('value decoding in protocol version 1.1', async () => {

    const first = await parseValid('SEND\nfoo:\\n\\n\\c\\\\\n\n\x00', {...someReadParams, protocolVersion: STOMP_VERSION_11});
  
    expect(first.headers.get('foo')).toBe('\n\n:\\');

    const second = await parseValid('SEND\na\\c:b\\n\n\n\x00', {...someReadParams, protocolVersion: STOMP_VERSION_11});

    expect(second.headers.get('a:')).toBe('b\n');
  });

  test('value decoding in protocol version 1.2', async () => {

    const first = await parseValid('SEND\nfoo:\r\\r\\n\\c\\\\\n\n\x00', {...someReadParams, protocolVersion: STOMP_VERSION_12});

    expect(first.headers.get('foo')).toBe('\r\r\n:\\');
  });

  test('header completion of partial frame', async () => {

    const reader = new Reader((async function* () {
      const encoder = new TextEncoder();
      yield encoder.encode('SEND');
      yield encoder.encode('\ncontent');
      yield encoder.encode('-type:text\/something\n');
      yield encoder.encode('\n');
      await neverResolve();
    })());

    const readResult = await readFrame(reader, someReadParams);

    if (readResult.error) {
      expect(readResult.error).toBeUndefined();
      return;
    }

    expect(readResult.value).toBeDefined();

    if (!readResult.value) {
      return;
    }

    const frame = readResult.value;

    expect(frame.command).toBe('SEND');
    expect(frame.headers.get('content-type')).toBe('text\/something');
  });

  test('exceed maxLineLength', async () => {

    const readResult = await readFrame(reader('CONNECT\n'), {...someReadParams, maxLineLength: 4});

    expect(readResult.error).toBeDefined();

    if (!readResult.error) {
      return;
    }

    expect(readResult.error.message).toBe('maximum line length exceeded');
  });

  test('exceed maxLineLength on header line', async () => {

    const readResult = await readFrame(reader('CONNECT\naweroaiweurapoweiurawerawuera\n'), {...someReadParams, maxLineLength: 10});

    expect(readResult.error).toBeDefined();

    if (!readResult.error) {
      return;
    }

    expect(readResult.error.message).toBe('maximum line length exceeded');
  });

  test('exceed maxHeaderLines', async () => {

    const readResult = await readFrame(reader('CONNECT\nfoo:a\nfoo:b\nfoo:c\n\n\x00'), {...someReadParams, maxHeaderLines: 2});

    expect(readResult.error).toBeDefined();

    if (!readResult.error) {
      return;
    }

    expect(readResult.error.message).toBe('maximum header lines exceeded');
  });

  test('exceed maxBodyLength of a dynamic-size body', async () => {

    const frame = await parseValid('SEND\n\nhello\x00', {...someReadParams, maxBodyLength: 1});

    const body = await read(frame.body);

    expect(body.error).toBeDefined();
    expect(body.error?.message).toBe('frame body too large');    
  });

  test('exceed maxBodyLength of a fixed-size body', async () => {

    const frame = await parseValid('SEND\ncontent-length:5\n\nhello\x00', {...someReadParams, maxBodyLength: 1});

    const body = await read(frame.body);

    expect(body.error).toBeDefined();
    expect(body.error?.message).toBe('frame body too large');   
  });

  test('maxBodyChunkLength of a dyanmic-size body', async () => {

    const frame = await parseValid('SEND\n\nhi\x00', {...someReadParams, maxBodyChunkLength: 1});

    const chunk1 = await frame.body.next();

    expect(chunk1.done).toBe(false);
    expect(chunk1.value).toBeDefined();

    if (!chunk1.value) {
      return;
    }

    expect(chunk1.value.error).toBeUndefined();
    expect(chunk1.value.value).toBeDefined();
    expect(chunk1.value.value.length).toBe(1);
    expect(chunk1.value.value[0]).toBe('h'.charCodeAt(0));

    const chunk2 = await frame.body.next();

    expect(chunk2.done).toBe(false);
    expect(chunk2.value).toBeDefined();

    if (!chunk2.value) {
      return;
    }

    expect(chunk2.value.error).toBeUndefined();
    expect(chunk2.value.value).toBeDefined();
    expect(chunk2.value.value.length).toBe(1);
    expect(chunk2.value.value[0]).toBe('i'.charCodeAt(0));

    const chunk3 = await frame.body.next();

    expect(chunk3.done).toBe(false);
    expect(chunk3.value).toBeDefined();

    if (!chunk3.value) {
      return;
    }

    expect(chunk3.value.error).toBeUndefined();
    expect(chunk3.value.value).toBeDefined();
    expect(chunk3.value.value.length).toBe(0);

    const chunk4 = await frame.body.next();

    expect(chunk4.done).toBe(true);
    expect(chunk4.value).toBeUndefined();
  });
  
  test('maxBodyChunkLength of a fixed-size body', async () => {

    const frame = await parseValid('SEND\ncontent-length:2\n\nhi\x00', {...someReadParams, maxBodyChunkLength: 1});

    const chunk1 = await frame.body.next();

    expect(chunk1.done).toBe(false);
    expect(chunk1.value).toBeDefined();

    if (!chunk1.value) {
      return;
    }

    expect(chunk1.value.error).toBeUndefined();
    expect(chunk1.value.value).toBeDefined();
    expect(chunk1.value.value.length).toBe(1);
    expect(chunk1.value.value[0]).toBe('h'.charCodeAt(0));

    const chunk2 = await frame.body.next();

    expect(chunk2.done).toBe(false);
    expect(chunk2.value).toBeDefined();

    if (!chunk2.value) {
      return;
    }

    expect(chunk2.value.error).toBeUndefined();
    expect(chunk2.value.value).toBeDefined();
    expect(chunk2.value.value.length).toBe(1);
    expect(chunk2.value.value[0]).toBe('i'.charCodeAt(0));

    const chunk3 = await frame.body.next();

    expect(chunk3.done).toBe(false);
    expect(chunk3.value).toBeDefined();

    if (!chunk3.value) {
      return;
    }

    expect(chunk3.value.error).toBeUndefined();
    expect(chunk3.value.value).toBeDefined();
    expect(chunk3.value.value.length).toBe(0);

    const chunk4 = await frame.body.next();

    expect(chunk4.done).toBe(true);
    expect(chunk4.value).toBeUndefined();
  });

  test('malformed command line', async () => {

    const readResult = await readFrame(reader('\n'), {...someReadParams, ignoreLeadingEmptyLines: false});

    expect(readResult.error).toBeDefined();
    expect(readResult.error?.message).toBe('malformed frame expected command line');
  });

  test('malformed header line', async () => {

    const readResult = await readFrame(reader('CONNECT\ninvalidheader\n'), {...someReadParams, ignoreLeadingEmptyLines: false});

    expect(readResult.error).toBeDefined();
    expect(readResult.error?.message).toBe('header parse error invalidheader');
  });
});
