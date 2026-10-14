import { randomUUID } from 'node:crypto';

import { HttpError, acceptDurableOperation, asyncJobs } from 'shared';
import type { OperationOwner } from 'shared';
import { getProject, listAsyncJobsForProject, findAsyncJobById } from 'projects';

type ProjectSeedContext = {
  accountId: string;
  userId: string;
};

async function listProjectJobs(context: ProjectSeedContext, projectId: string) {
  return listAsyncJobsForProject(context, projectId);
}

async function queueProjectSeed(context: OperationOwner, projectId: string, requestKey: string = randomUUID()) {
  const project = await getProject(context, projectId);

  if (!project) {
    throw new HttpError({ code: 'project_not_found', message: 'The project could not be found.', statusCode: 404 });
  }

  const operation = await acceptDurableOperation(
    context,
    { requestKey, kind: 'project_seed', fingerprint: projectId },
    async (transaction, operationId) => {
      await transaction.insert(asyncJobs).values({
        id: operationId,
        accountId: context.accountId,
        userId: context.userId,
        projectId,
        type: 'project_seed',
        status: 'queued',
        progress: 0,
      });

      return { accountId: context.accountId, userId: context.userId, projectId, jobId: operationId };
    },
  );
  const job = await findAsyncJobById(context, operation.id);

  if (!job) throw new Error('The accepted operation is missing its job.');

  return { ...job, operation: { operationId: operation.id, expiresAt: operation.expiresAt.toISOString() } };
}

export { listProjectJobs, queueProjectSeed };
