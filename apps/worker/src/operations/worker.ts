import { processNextOperation } from './processor';
import { processNextPush } from './push-processor';

import { logger } from 'shared';

/** Database-backed outbox survives HTTP/Redis outages and process restarts. */
export function startOperationWorker(): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    let worked = false;

    try {
      worked = await processNextOperation();
    } catch {
      logger.warn({ code: 'operation_poll_unavailable' }, 'Durable operation polling is temporarily unavailable');
    }
    try {
      worked = (await processNextPush()) || worked;
    } catch {
      logger.warn({ code: 'push_poll_unavailable' }, 'Push delivery polling is temporarily unavailable');
    }
    if (!stopped)
      timer = setTimeout(
        () => {
          running = run();
        },
        worked ? 0 : 1000,
      );
  };

  let running = run();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}
