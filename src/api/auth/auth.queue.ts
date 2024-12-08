import { Queue } from 'bullmq';

import { JobData } from './auth.dto';
import {
  redisConnection,
  TEMPORARY_ONE_TIME_CODES_QUEUE,
} from './auth.constants';

export const otpQueue = new Queue<JobData>(TEMPORARY_ONE_TIME_CODES_QUEUE, {
  connection: redisConnection,
});
