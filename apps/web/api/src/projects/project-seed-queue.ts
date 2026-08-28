import { HttpError } from 'shared';
import {
  createAsyncJob,
  getProject,
  getProjectSeedQueue,
  listAsyncJobsForProject,
  publishProjectAsyncJobEvent,
} from 'projects';

type ProjectSeedContext = {
  accountId: string;
  userId: string;
};

async function listProjectJobs(context: ProjectSeedContext, projectId: string) {
  return listAsyncJobsForProject(context, projectId);
}

async function queueProjectSeed(context: ProjectSeedContext, projectId: string) {
  const project = await getProject(context, projectId);

  if (!project) {
    throw new HttpError({ code: 'project_not_found', message: 'The project could not be found.', statusCode: 404 });
  }

  const job = await createAsyncJob(context, {
    projectId,
    type: 'project_seed',
  });

  await getProjectSeedQueue().add('project_seed', {
    accountId: context.accountId,
    jobId: job.id,
    projectId,
    userId: context.userId,
  });
  await publishProjectAsyncJobEvent('job:queued', job, 'Project seed queued.');

  return job;
}

export { listProjectJobs, queueProjectSeed };
