import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { getRedis } from 'shared';

import type { ProjectSeedJobInput } from '../contracts/project-seed';

const projectSeedQueueName = 'project-seed';

const queueKey = '__themisProjectSeedQueue';

const globalState = globalThis as typeof globalThis & {
  [queueKey]?: Queue<ProjectSeedJobInput, unknown, string>;
};

function getProjectSeedQueue() {
  globalState[queueKey] ??= new Queue<ProjectSeedJobInput, unknown, string>(projectSeedQueueName, {
    connection: getRedis() as unknown as Redis,
  });

  return globalState[queueKey];
}

export { getProjectSeedQueue, projectSeedQueueName };
