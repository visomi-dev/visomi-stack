import type { Job } from 'bullmq';
import { Worker } from 'bullmq';

import { getRedis } from 'shared';
import { type ProjectSeedJobInput, failProjectSeedJob, processProjectSeedJob, projectSeedQueueName } from 'projects';

function toError(error: Error | unknown) {
  return error instanceof Error ? error : new Error('Project seed worker failed.');
}

function startProjectSeedWorker() {
  const worker = new Worker(
    projectSeedQueueName,
    async (bullJob: Job<ProjectSeedJobInput>) => processProjectSeedJob(bullJob),
    {
      connection: getRedis(),
    },
  );

  worker.on('failed', async (bullJob, error) => {
    if (!bullJob) {
      return;
    }

    await failProjectSeedJob({ data: bullJob.data }, toError(error));
  });

  return worker;
}

export { startProjectSeedWorker };
