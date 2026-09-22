import { parseProjectJob, processObservedProjectJob } from './processor';

import { processProjectSeedJob } from 'projects';

jest.mock('projects', () => ({ processProjectSeedJob: jest.fn() }));

const input = {
  accountId: '11111111-1111-4111-8111-111111111111',
  jobId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  userId: '44444444-4444-4444-8444-444444444444',
};

describe('project seed transport boundary', () => {
  it('rejects unknown fields, missing tenant context and malformed identifiers', () => {
    expect(() => parseProjectJob({ ...input, injected: true })).toThrow('Invalid project seed job input.');
    expect(() => parseProjectJob({ ...input, accountId: undefined })).toThrow();
    expect(() => parseProjectJob({ ...input, userId: 'secret-invalid-input' })).toThrow(
      'Invalid project seed job input.',
    );
    expect(() => parseProjectJob({ ...input, observability: { requestId: 'transport' } })).toThrow();
  });

  it('passes only validated domain data to the existing processor', async () => {
    await processObservedProjectJob(input);
    expect(processProjectSeedJob).toHaveBeenCalledWith({ data: input });
  });
});
