import { processObservedProjectJob } from '../projects/project-seed/processor';

import { processNextOperation } from './processor';

import { claimDurableOperation, finishDurableOperation, hasOperationMembership, expirePushSubscriptions } from 'shared';
import { failProjectSeedJob, findAsyncJobById } from 'projects';

const operation = {
  id: '22222222-2222-4222-8222-222222222222',
  sessionId: 'test-session',
  authVersion: 1,
  accountId: '11111111-1111-4111-8111-111111111111',
  userId: '44444444-4444-4444-8444-444444444444',
  payload: {
    accountId: '11111111-1111-4111-8111-111111111111',
    userId: '44444444-4444-4444-8444-444444444444',
    projectId: '33333333-3333-4333-8333-333333333333',
    jobId: '22222222-2222-4222-8222-222222222222',
  },
};
const authority = jest.fn(async (_scope: unknown, run: () => Promise<void>) => run());

jest.mock('shared', () => ({
  claimDurableOperation: jest.fn(),
  expireDurableOperations: jest.fn(),
  expirePushSubscriptions: jest.fn(),
  finishDurableOperation: jest.fn(),
  createSessionStore: () => ({
    withSessionAuthority: authority,
    get: (_sid: string, callback: (error: unknown, data: unknown) => void) =>
      callback(null, { passport: { user: { accountId: '11111111-1111-4111-8111-111111111111' } } }),
  }),
  isSessionAuthorityStore: () => true,
  hasOperationMembership: jest.fn(),
  env: { DATABASE_DRIVER: 'memory' },
  logger: { warn: jest.fn() },
}));
jest.mock('projects', () => ({
  failProjectSeedJob: jest.fn(),
  findAsyncJobById: jest.fn(),
  getProject: jest.fn(async () => ({ id: 'project' })),
}));
jest.mock('../projects/project-seed/processor', () => ({
  ...jest.requireActual('../projects/project-seed/processor'),
  processObservedProjectJob: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(claimDurableOperation).mockResolvedValue(operation as Awaited<ReturnType<typeof claimDurableOperation>>);
  jest.mocked(hasOperationMembership).mockResolvedValue(true);
  jest.mocked(findAsyncJobById).mockResolvedValue({ status: 'queued' } as Awaited<ReturnType<typeof findAsyncJobById>>);
  authority.mockImplementation(async (_scope: unknown, run: () => Promise<void>) => run());
});

describe('operation worker', () => {
  it('holds current session authority while processing and publishing bounded completion', async () => {
    expect(await processNextOperation()).toBe(true);
    expect(authority).toHaveBeenCalledWith(
      expect.objectContaining({ userId: operation.userId, currentSid: operation.sessionId, authority: 'full' }),
      expect.any(Function),
    );
    expect(processObservedProjectJob).toHaveBeenCalledWith(operation.payload);
    expect(finishDurableOperation).toHaveBeenCalledWith(operation, {
      operationId: operation.id,
      status: 'completed',
      result: { jobId: operation.id },
    });
  });

  it('recovers completion after a process crash without replaying a completed feature job', async () => {
    jest
      .mocked(findAsyncJobById)
      .mockResolvedValue({ status: 'completed' } as Awaited<ReturnType<typeof findAsyncJobById>>);
    await processNextOperation();
    expect(processObservedProjectJob).not.toHaveBeenCalled();
    expect(finishDurableOperation).toHaveBeenCalledWith(operation, expect.objectContaining({ status: 'completed' }));
  });

  it('rejects revoked sessions, removed membership and substituted routing before feature work', async () => {
    authority.mockRejectedValueOnce(new Error('Revoked session'));
    await processNextOperation();
    jest.mocked(hasOperationMembership).mockResolvedValueOnce(false);
    await processNextOperation();
    jest.mocked(claimDurableOperation).mockResolvedValueOnce({
      ...operation,
      payload: { ...operation.payload, accountId: 'foreign-account' },
    } as Awaited<ReturnType<typeof claimDurableOperation>>);
    await processNextOperation();
    expect(processObservedProjectJob).not.toHaveBeenCalled();
    expect(finishDurableOperation).toHaveBeenCalledTimes(3);
    expect(finishDurableOperation).toHaveBeenLastCalledWith(expect.anything(), {
      operationId: operation.id,
      status: 'failed',
      error: { code: 'operation_unavailable', status: 409 },
    });
  });

  it('does not detach processing when the outbox has no ready work', async () => {
    jest.mocked(claimDurableOperation).mockResolvedValueOnce(null);
    expect(await processNextOperation()).toBe(false);
    expect(expirePushSubscriptions).toHaveBeenCalledTimes(1);
    expect(authority).not.toHaveBeenCalled();
  });

  it('leaves successful feature writes recoverable when result storage is temporarily unavailable', async () => {
    jest.mocked(finishDurableOperation).mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(processNextOperation()).rejects.toThrow('Operation completion storage is unavailable');
    expect(failProjectSeedJob).not.toHaveBeenCalled();
    expect(finishDurableOperation).toHaveBeenCalledTimes(1);
  });

  it('records system-owned failure metadata without running revoked feature work', async () => {
    jest
      .mocked(findAsyncJobById)
      .mockResolvedValue({ status: 'queued', projectId: operation.payload.projectId } as Awaited<
        ReturnType<typeof findAsyncJobById>
      >);
    authority.mockRejectedValueOnce(new Error('Revoked'));
    await processNextOperation();
    expect(processObservedProjectJob).not.toHaveBeenCalled();
    expect(failProjectSeedJob).toHaveBeenCalledWith({ data: operation.payload }, expect.any(Error));
  });
});
