import { session, logger } from './lib/app_utils';
import { FrameHeaders } from '../../src/frame/header';
import { readString, writeString } from '../../src/frame/body';
import { discardMessages } from '../../src/client/message';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function speedtest() {

  //const buf = Buffer.alloc(10);
  //console.log(crypto.randomFillSync(buf).toString('hex'));

  const log = logger('Supervisor');

  const duration = 2000;
  const queueName = '/queue/speedtest';
 
  let running = true;

  let sent = 0;
  let received = 0;

  const start = process.hrtime.bigint();
  
  const producer = session('Producer', async (session, log) => {

    while (running) {
     
      const message = {
        command: 'SEND', 
        headers: new FrameHeaders([
          ['Destination', queueName]
        ]),
        body: writeString('test')
      };

      const sendError = await session.send(message);

      if (sendError) {
        throw sendError;
      }

      sent += 1;
    }
  });

  const consumer = session('Consumer', async (session, log) => {

    const subRequestResult = await session.subscribe(queueName);

    if (subRequestResult.error) {
      throw subRequestResult.error;
    }

    const subscription = subRequestResult.value;

    (async () => {
      await sleep(duration);
      await session.disconnect();
    })();

    while (true) {

      const receiveResult = await session.receive(subscription);
      
      if (receiveResult.error) {
        throw receiveResult.error;
      }

      if (receiveResult.cancelled) {
        break;
      }

      const message = receiveResult.value;

      const readResult = await readString(message.body);

      if (readResult.error) {
        throw readResult.error;
      }
  
      received += 1;
    }
  });

  log(`Running test for ${duration / 1000} seconds`);

  await sleep(duration);

  running = false;

  await Promise.all([producer, consumer]);

  const end = process.hrtime.bigint();

  const elapsed = Number((end - start) / BigInt(Math.pow(1000, 2)));

  log(`Producer message rate: ${Math.round(sent / elapsed * 1000)}/s`);
  log(`Consumer message rate: ${Math.round(received / elapsed * 1000)}/s`);

}

speedtest();
