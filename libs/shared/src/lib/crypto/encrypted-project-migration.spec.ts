import { MigrationLedger, migrateProjectRecord } from './encrypted-project-migration';

const encrypt = (payload: string) => ({
  authTag: 'dGFn',
  ciphertext: Buffer.from(payload).toString('base64url'),
  nonce: 'bm9uY2U',
});

function input(overrides: Record<string, unknown> = {}) {
  return {
    accountId: 'account-a',
    envelopeId: 'migration-1',
    record: {
      activity: [{ message: 'private activity' }],
      context: { summary: 'private context' },
      id: 'legacy-1',
      projectId: 'workspace-a',
    },
    workspaceId: 'workspace-a',
    now: new Date('2026-08-17T22:00:00.000Z'),
    encrypt,
    ...overrides,
  } as Parameters<typeof migrateProjectRecord>[0];
}

describe('encrypted project migration boundary', () => {
  it('produces an opaque versioned envelope and keeps payload out of envelope metadata', () => {
    const result = migrateProjectRecord(input());

    expect(result.kind).toBe('migrated');
    if (result.kind === 'migrated') {
      expect(result.envelope.recordType).toBe('project-context-activity');
      expect(JSON.stringify(result.envelope.metadata)).not.toContain('private');
      expect(result.envelope.ciphertext).not.toContain('private activity');
    }
  });

  it.each([
    [
      { id: '', projectId: 'workspace-a' },
      { kind: 'rejected', reason: 'malformed' },
    ],
    [
      { id: 'legacy-1', projectId: 'workspace-a' },
      { kind: 'deferred', reason: 'unavailable' },
    ],
    [
      { activity: [], id: 'legacy-1', projectId: 'workspace-a' },
      { kind: 'deferred', reason: 'partial' },
    ],
  ])('does not migrate unsafe legacy input (%s)', (record, decision) => {
    expect(migrateProjectRecord(input({ record }))).toEqual(decision);
  });

  it('deduplicates identical migration output and rejects conflicting reuse', () => {
    const ledger = new MigrationLedger();
    const first = ledger.accept(migrateProjectRecord(input()));
    const duplicate = ledger.accept(migrateProjectRecord(input()));
    const conflicting = ledger.accept(
      migrateProjectRecord(input({ record: { ...input().record, context: { changed: true } } })),
    );

    expect(first.kind).toBe('migrated');
    expect(duplicate.kind).toBe('duplicate');
    expect(conflicting).toEqual({ kind: 'rejected', reason: 'malformed' });
  });

  it.each([
    { activity: 'not-an-activity', context: {} },
    { activity: [], context: 'not-context' },
    { activity: [{ value: undefined }], context: {} },
  ])('rejects malformed protected values without invoking encryption', (record) => {
    let encryptCalls = 0;
    const encryptSpy = (payload: string) => {
      encryptCalls += 1;

      return encrypt(payload);
    };

    expect(migrateProjectRecord(input({ record: { ...input().record, ...record }, encrypt: encryptSpy }))).toEqual({
      kind: 'rejected',
      reason: 'malformed',
    });
    expect(encryptCalls).toBe(0);
  });

  it('deduplicates across ledger restarts through the supplied persistence boundary', () => {
    let persisted: Record<string, string> = {};
    const persistence = {
      load: () => persisted,
      save: (next: Readonly<Record<string, string>>) => {
        persisted = { ...next };
      },
    };

    const first = new MigrationLedger(persistence).accept(migrateProjectRecord(input()));
    const afterRestart = new MigrationLedger(persistence).accept(migrateProjectRecord(input()));

    expect(first.kind).toBe('migrated');
    expect(afterRestart).toEqual({ kind: 'duplicate', fingerprint: expect.any(String) });
  });

  it('denies recovery of a tombstoned envelope', () => {
    const ledger = new MigrationLedger();

    ledger.accept(migrateProjectRecord(input()));
    ledger.tombstone('migration-1');

    expect(ledger.accept(migrateProjectRecord(input()))).toEqual({ kind: 'rejected', reason: 'tombstoned' });
  });
});
