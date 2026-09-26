import {
  materializationStateSchema,
  parseProjectSyncEnvelope,
  projectCursorSchema,
  projectEntityKinds,
  projectNotificationSchema,
  serializeProjectSyncEnvelope,
} from './project-sync-contract';

const envelope = {
  format: 'themis.project-sync-envelope' as const,
  version: 1 as const,
  streamKind: 'event' as const,
  projectId: 'project-a',
  envelopeId: 'envelope-a-1',
  idempotencyKey: 'idempotency-a-1',
  revision: 1,
  baseCursor: 0,
  entityKind: 'project' as const,
  nonce: 'nonce',
  ciphertext: 'ciphertext-only',
  authTag: 'tag',
};

describe('project-scoped synchronization contract v1', () => {
  it('covers every projected domain entity and keeps payload opaque', () => {
    expect(projectEntityKinds).toEqual([
      'project',
      'epic',
      'work-item',
      'dependency',
      'sprint',
      'sprint-revision',
      'membership',
      'sprint-evidence',
      'run',
      'run-evidence',
      'review',
      'claim',
      'status-transition',
      'activity',
      'timeline-event',
    ]);
    const serialized = serializeProjectSyncEnvelope(envelope);

    expect(serialized).toContain('ciphertext-only');
    expect(serialized).not.toMatch(/summary|title|description|password|secret|\.themis|\/home/);
    expect(parseProjectSyncEnvelope(JSON.parse(serialized))).toEqual(envelope);
  });

  it('validates independently loadable cursor, notification, and materialization state', () => {
    expect(
      projectCursorSchema.parse({
        projectId: 'project-a',
        cursor: 4,
        revision: 4,
        checkpointId: null,
        tombstoneHorizon: 2,
      }),
    ).toBeDefined();
    expect(
      projectNotificationSchema.parse({
        format: 'themis.project-sync-notification',
        version: 1,
        projectId: 'project-a',
        latestCursor: 4,
        latestRevision: 4,
        checkpointHint: null,
        streamKind: 'event',
        correlationId: 'correlation-a',
      }),
    ).toBeDefined();
    expect(
      materializationStateSchema.parse({
        projectId: 'project-a',
        schemaVersion: 1,
        cursor: { projectId: 'project-a', cursor: 4, revision: 4, checkpointId: null, tombstoneHorizon: 2 },
        status: 'ready',
        lastErrorCode: null,
      }),
    ).toBeDefined();
  });

  it('rejects plaintext-shaped or cross-project contract additions', () => {
    expect(() => parseProjectSyncEnvelope({ ...envelope, title: 'plaintext' })).toThrow();
    expect(() => parseProjectSyncEnvelope({ ...envelope, projectId: '' })).toThrow();
    expect(() => parseProjectSyncEnvelope({ ...envelope, version: 2 })).toThrow();
  });
});
