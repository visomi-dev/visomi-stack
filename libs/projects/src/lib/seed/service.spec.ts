import type { AsyncJobRecord } from '../contracts/async-jobs';

const findAsyncJobById = jest.fn();
const updateAsyncJob = jest.fn();
const createDocument = jest.fn();
const getProject = jest.fn();
const publishProjectAsyncJobEvent = jest.fn().mockResolvedValue(undefined);

jest.mock('../records/async-job-records', () => ({ findAsyncJobById, updateAsyncJob }));
jest.mock('../projects-service', () => ({ createDocument, getProject }));
jest.mock('./events', () => ({ publishProjectAsyncJobEvent }));

import { failProjectSeedJob, processProjectSeedJob, projectSeedFailureMessage } from './service';

const job: AsyncJobRecord = {
  completedAt: null,
  createdAt: '2026-08-17T22:00:00.000Z',
  errorMessage: null,
  id: 'job-a',
  progress: 0,
  projectId: 'project-a',
  resultJson: null,
  status: 'queued',
  type: 'project_seed',
  updatedAt: '2026-08-17T22:00:00.000Z',
  userId: 'user-a',
};

describe('project seed service', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    findAsyncJobById.mockResolvedValue(job);
    updateAsyncJob.mockResolvedValue(job);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('completes without creating a protected legacy document', async () => {
    const resultPromise = processProjectSeedJob({
      data: { accountId: 'account-a', jobId: job.id, projectId: job.projectId!, userId: job.userId },
    });

    await jest.advanceTimersByTimeAsync(1_200);
    await resultPromise;

    expect(createDocument).not.toHaveBeenCalled();
    expect(updateAsyncJob).toHaveBeenCalledWith(
      { accountId: 'account-a', userId: 'user-a' },
      job.id,
      expect.objectContaining({ progress: 100, status: 'completed' }),
    );
  });

  it('publishes a bounded failure message instead of the error detail', async () => {
    const secret = 'database password: do-not-publish';

    await failProjectSeedJob(
      { data: { accountId: 'account-a', jobId: job.id, projectId: job.projectId!, userId: job.userId } },
      new Error(secret),
    );

    expect(publishProjectAsyncJobEvent).toHaveBeenCalledWith('job:failed', job, projectSeedFailureMessage);
    expect(JSON.stringify(publishProjectAsyncJobEvent.mock.calls)).not.toContain(secret);
  });
});
