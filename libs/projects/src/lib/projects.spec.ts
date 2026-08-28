import { projectAsyncJobEventsChannel, projectSeedQueueName } from '../index';

import { mapAsyncJob } from './records/async-job-records';
import { mapDocument, mapProject } from './projects-service';

const date = new Date('2026-08-17T22:00:00.000Z');

describe('projects contracts', () => {
  it('exposes stable queue and event names', () => {
    expect(projectSeedQueueName).toBe('project-seed');
    expect(projectAsyncJobEventsChannel).toBe('projects.async-job');
  });

  it('does not expose legacy protected project or document content', () => {
    const project = mapProject({
      accountId: 'account-a',
      createdAt: date,
      createdByUserId: 'user-a',
      id: 'project-a',
      name: 'Project',
      slug: 'project',
      sourceType: 'manual',
      status: 'active',
      updatedAt: date,
    });
    const document = mapDocument({
      accountId: 'account-a',
      createdAt: date,
      createdByUserId: 'user-a',
      documentType: 'overview',
      id: 'document-a',
      projectId: 'project-a',
      source: 'manual',
      status: 'active',
      title: 'Overview',
      updatedAt: date,
    });

    expect(JSON.stringify({ project, document })).not.toContain('private');
  });

  it('does not expose legacy job payloads or diagnostics', () => {
    const job = mapAsyncJob({
      accountId: 'account-a',
      completedAt: date,
      createdAt: date,
      id: 'job-a',
      progress: 100,
      projectId: 'project-a',
      status: 'completed',
      type: 'project_seed',
      updatedAt: date,
      userId: 'user-a',
    });

    expect(JSON.stringify(job)).not.toContain('private');
    expect(JSON.stringify(job)).not.toContain('secret');
  });
});
