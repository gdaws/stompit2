import { session, logger } from './lib/app_utils';
import { RESULT_OK, RESULT_CANCELLED, failed, error, result } from '../../src/result';
import { FrameHeaders } from '../../src/frame/header';
import { writeBuffer } from '../../src/frame/body';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function speedtest() {
  const log = logger('Supervisor');

  const duration = 5000;
  const bodySize = 128;
  const queueName = '/queue/speedtest';

  const messageBody = Buffer.alloc(bodySize);

  let running = true;

  let sent = 0;
  let received = 0;

  const start = process.hrtime.bigint();

  const producer = session('Producer', async (session, log) => {
    while (running) {
      const message = {
        command: 'SEND',
        headers: new FrameHeaders([
          ['Destination', queueName],
          ['Content-length', '' + bodySize]
        ]),
        body: writeBuffer(messageBody)
      };

      const sendError = await session.send(message);

      if (sendError) {
        throw sendError;
      }

      sent += 1;
    }
  });

  const consumer = session('Consumer', async (session, log) => {
    const subscription = result(await session.subscribe(queueName));

    (async () => {
      await sleep(duration);
      await session.disconnect();
    })();

    while (true) {
      const receiveResult = await session.receive(subscription);

      if (receiveResult.status !== RESULT_OK) {
        if (receiveResult.status === RESULT_CANCELLED) {
          break;
        }
        else {
          throw error(receiveResult);
        }
      }

      const message = receiveResult.value;

      for await (const chunkResult of message.body) {
        if (failed(chunkResult)) {
          throw error(chunkResult);
        }
      }

      received += 1;
    }
  });

  log(`Running test for ${duration / 1000} seconds`);

  await sleep(duration);

  running = false;

  const [producerError, consumerError] = await Promise.all([producer, consumer]);

  const end = process.hrtime.bigint();

  const elapsed = Number((end - start) / BigInt(Math.pow(1000, 2)));

  log(`Producer message rate: ${Math.round(sent / elapsed * 1000)}/s`);
  log(`Consumer message rate: ${Math.round(received / elapsed * 1000)}/s`);

  if (producerError || consumerError) {
    if (producerError) {
      log('Producer session failed to complete');
    }

    if (consumerError) {
      log('Consumer session failed to complete');
    }

    process.exit(1);
  }
}

speedtest();
