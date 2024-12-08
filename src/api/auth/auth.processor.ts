import { Worker } from 'bullmq';

import { JobData } from './auth.dto';
import {
  redisConnection,
  TEMPORARY_ONE_TIME_CODES_QUEUE,
} from './auth.constants';

import { db } from '~/api/shared/db';

export const worker = new Worker<JobData>(
  TEMPORARY_ONE_TIME_CODES_QUEUE,
  async function deleteTemporaryOneTimeCode({ data: { id } }) {
    const oneTimeCode = await db.oneTimeCode.findUnique({
      where: { id },
    });

    if (!oneTimeCode) {
      return;
    }

    await db.oneTimeCode.delete({
      where: { id },
    });
  },
  {
    connection: redisConnection,
    removeOnFail: { count: 0 },
    removeOnComplete: { count: 0 },
    runRetryDelay: 1000,
  },
);
