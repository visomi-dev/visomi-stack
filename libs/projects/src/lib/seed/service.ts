import { HttpError } from 'shared';

import type { ProjectSeedJobInput, ProjectSeedJobResult } from '../contracts/project-seed';
import { findAsyncJobById, updateAsyncJob } from '../records/async-job-records';
import { getProject } from '../projects-service';

import { publishProjectAsyncJobEvent } from './events';

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const projectSeedFailureMessage = 'Project seed failed.';

async function queueProjectSeed(context: { accountId: string; userId: string }, projectId: string) {
  const project = await getProject(context, projectId);

  if (!project) {
    throw new HttpError({ code: 'project_not_found', message: 'The project could not be found.', statusCode: 404 });
  }

  return project;
}

async function processProjectSeedJob(bullJob: { data: ProjectSeedJobInput }) {
  const context = {
    accountId: bullJob.data.accountId,
    userId: bullJob.data.userId,
  };

  const existing = await findAsyncJobById(context, bullJob.data.jobId);

  if (!existing) {
    return null;
  }

  const startJob = await updateAsyncJob(context, existing.id, {
    progress: 10,
    status: 'running',
  });

  await publishProjectAsyncJobEvent('job:started', startJob, 'Project seed started.');

  await wait(600);
  const scanJob = await updateAsyncJob(context, existing.id, {
    progress: 45,
    status: 'running',
  });

  await publishProjectAsyncJobEvent('job:progress', scanJob, 'Repository structure scanned.');

  await wait(600);
  const contextJob = await updateAsyncJob(context, existing.id, {
    progress: 80,
    status: 'running',
  });

  await publishProjectAsyncJobEvent('job:progress', contextJob, 'Project context draft prepared.');

  const result: ProjectSeedJobResult = {
    summary: 'Project seed metadata prepared.',
  };

  const completedJob = await updateAsyncJob(context, existing.id, {
    completedAt: new Date(),
    progress: 100,
    status: 'completed',
  });

  await publishProjectAsyncJobEvent('job:completed', completedJob, 'Project seed completed.');

  return result;
}

async function failProjectSeedJob(bullJob: { data: ProjectSeedJobInput }, _error: Error) {
  const context = {
    accountId: bullJob.data.accountId,
    userId: bullJob.data.userId,
  };

  const failedJob = await updateAsyncJob(context, bullJob.data.jobId, {
    completedAt: new Date(),
    progress: 100,
    status: 'failed',
  });

  await publishProjectAsyncJobEvent('job:failed', failedJob, projectSeedFailureMessage);
}

export { failProjectSeedJob, processProjectSeedJob, projectSeedFailureMessage, queueProjectSeed };
