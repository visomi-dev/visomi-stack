import type { Job } from 'bullmq';
import { Worker } from 'bullmq';

import { parseProjectJob, processObservedProjectJob } from './processor';

import { getRedis, logger, observeProjectJob, withCorrelation } from 'shared';
import { type ProjectSeedJobInput, failProjectSeedJob, projectSeedQueueName } from 'projects';

function toError(error: Error | unknown) {
  return error instanceof Error ? error : new Error('Project seed worker failed.');
}

function startProjectSeedWorker() {
  const worker = new Worker(
    projectSeedQueueName,
    async (bullJob: Job<ProjectSeedJobInput>) =>
      observeProjectJob<ProjectSeedJobInput, Awaited<ReturnType<typeof processObservedProjectJob>>>(
        bullJob.data,
        processObservedProjectJob,
        (event) => logger.info(event, 'Project job completed'),
      ),
    {
      connection: getRedis(),
    },
  );

  worker.on('failed', async (bullJob, error) => {
    if (!bullJob) {
      return;
    }

    const { observability: _observability, ...data } = (bullJob.data ?? {}) as ProjectSeedJobInput & {
      observability?: unknown;
    };

    await withCorrelation((_observability as { requestId?: unknown } | undefined)?.requestId, async () => {
      try {
        await failProjectSeedJob({ data: parseProjectJob(data) }, toError(error));
      } catch {
        logger.warn({ code: 'project_failure_record_failed' }, 'Project job failure could not be recorded');
      }
    });
  });

  return worker;
}

export { startProjectSeedWorker };
