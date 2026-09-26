import { OpaqueSyncStore } from './opaque-sync';

const envelope = (overrides: Record<string, unknown> = {}) => ({
  associatedData: { schema: 'sync-v1' },
  authTag: 'tag',
  ciphertext: 'ciphertext',
  createdAt: '2026-08-17T22:00:00.000Z',
  envelopeId: 'envelope-1',
  format: 'themis.encrypted-envelope',
  kind: 'sync-object',
  metadata: { source: 'agent' },
  nonce: 'nonce',
  recordType: 'project-context',
  revision: 1,
  version: 1,
  workspaceId: 'workspace-a',
  ...overrides,
});

describe('OpaqueSyncStore', () => {
  it('round-trips opaque envelopes with a cursor', () => {
    const store = new OpaqueSyncStore();
    const result = store.append('account-a', 'workspace-a', envelope());

    expect(result).toMatchObject({ cursor: 1, duplicate: false, envelope: envelope() });
    expect(store.list('account-a', 'workspace-a')).toEqual([{ cursor: 1, envelope: envelope() }]);
  });

  it('rejects malformed, wrong-workspace, and replayed envelopes', () => {
    const store = new OpaqueSyncStore();

    store.append('account-a', 'workspace-a', envelope());
    expect(() => store.append('account-a', 'workspace-a', { ...envelope(), ciphertext: 'bad payload!' })).toThrow();
    expect(() => store.append('account-a', 'workspace-b', envelope())).toThrow();
    expect(() => store.append('account-a', 'workspace-a', envelope({ revision: 0 }))).toThrow();
    expect(() => store.append('account-a', 'workspace-a', envelope({ authTag: 'different' }))).toThrow();
  });

  it('deduplicates retries and isolates account/workspace cursors', () => {
    const store = new OpaqueSyncStore();
    const first = store.append('account-a', 'workspace-a', envelope());

    expect(store.append('account-a', 'workspace-a', envelope())).toMatchObject({
      cursor: first.cursor,
      duplicate: true,
    });
    expect(store.list('account-b', 'workspace-a')).toEqual([]);
    expect(store.list('account-a', 'workspace-b')).toEqual([]);
  });

  it('advances revisions once and rejects retries of both current and older revisions', () => {
    const store = new OpaqueSyncStore();
    const first = store.append('account-a', 'workspace-a', envelope());
    const secondEnvelope = envelope({ ciphertext: 'ciphertext-v2', revision: 2 });
    const second = store.append('account-a', 'workspace-a', secondEnvelope);

    expect(second).toMatchObject({ cursor: 2, duplicate: false, envelope: secondEnvelope });
    expect(store.append('account-a', 'workspace-a', secondEnvelope)).toMatchObject({
      cursor: second.cursor,
      duplicate: true,
      envelope: secondEnvelope,
    });
    expect(() => store.append('account-a', 'workspace-a', envelope())).toThrow('Envelope revision is a replay.');
    expect(first.cursor).toBeLessThan(second.cursor);
  });

  it('requires snapshot recovery after records are pruned', () => {
    const store = new OpaqueSyncStore(10);

    store.append('account-a', 'workspace-a', envelope(), 100);
    expect(() => store.list('account-a', 'workspace-a', 0, 100, 110)).toThrow('Cursor requires recovery.');
  });

  it('keeps the cursor monotonic after all retained records are pruned', () => {
    const store = new OpaqueSyncStore(10);

    store.append('account-a', 'workspace-a', envelope(), 100);
    expect(() => store.list('account-a', 'workspace-a', 0, 100, 110)).toThrow('Cursor requires recovery.');

    const result = store.append('account-a', 'workspace-a', envelope({ envelopeId: 'envelope-2', revision: 2 }), 111);

    expect(result.cursor).toBe(2);
    expect(store.list('account-a', 'workspace-a', 1, 100, 111)).toEqual([
      { cursor: 2, envelope: envelope({ envelopeId: 'envelope-2', revision: 2 }) },
    ]);
  });

  it('keeps cursors independent between project streams', () => {
    const store = new OpaqueSyncStore();

    expect(store.append('account-a', 'workspace-a', envelope()).cursor).toBe(1);
    expect(store.append('account-a', 'workspace-b', envelope({ workspaceId: 'workspace-b' })).cursor).toBe(1);
    expect(store.append('account-a', 'workspace-a', envelope({ envelopeId: 'envelope-2', revision: 2 })).cursor).toBe(
      2,
    );
  });

  it('retains a tombstone replay barrier after the record is pruned', () => {
    const store = new OpaqueSyncStore(10);

    store.append('account-a', 'workspace-a', envelope({ recordType: 'tombstone', revision: 2 }), 100);
    expect(() => store.list('account-a', 'workspace-a', 0, 100, 111)).toThrow('Cursor requires recovery.');
    expect(() => store.append('account-a', 'workspace-a', envelope({ revision: 1 }), 112)).toThrow('tombstoned replay');
  });

  it('rejects a stale base and a lower revision on a new envelope id across the stream', () => {
    const store = new OpaqueSyncStore();

    store.append('account-a', 'workspace-a', envelope({ revision: 1 }));
    store.append('account-a', 'workspace-a', envelope({ envelopeId: 'envelope-2', revision: 2 }));

    expect(() =>
      store.append(
        'account-a',
        'workspace-a',
        envelope({ envelopeId: 'envelope-3', revision: 3, metadata: { baseCursor: '1' } }),
      ),
    ).toThrow('stale stream base');
    expect(() => store.append('account-a', 'workspace-a', envelope({ envelopeId: 'envelope-4', revision: 2 }))).toThrow(
      'rolls back the stream',
    );
  });

  it('rejects an explicitly supplied zero cursor after the stream has advanced', () => {
    const store = new OpaqueSyncStore();

    store.append('account-a', 'workspace-a', envelope());

    expect(() =>
      store.append(
        'account-a',
        'workspace-a',
        envelope({ envelopeId: 'envelope-2', revision: 2, metadata: { baseCursor: '0' } }),
      ),
    ).toThrow('stale stream base');
  });

  it('requires checkpoint references to be a live stream chain entry', () => {
    const store = new OpaqueSyncStore();
    const first = store.append('account-a', 'workspace-a', envelope({ revision: 1 }));

    expect(() => store.checkpoint('account-a', 'workspace-a', 'checkpoint-1', first.cursor, 2, first.envelope)).toThrow(
      'not durable',
    );
    expect(
      store.checkpoint(
        'account-a',
        'workspace-a',
        'checkpoint-1',
        first.cursor,
        first.envelope.revision,
        first.envelope,
      ),
    ).toMatchObject({ checkpointId: 'checkpoint-1', cursor: 1, revision: 1 });
  });

  it('rejects a checkpoint envelope that is not the referenced chain object', () => {
    const store = new OpaqueSyncStore();
    const first = store.append('account-a', 'workspace-a', envelope({ revision: 1 }));

    expect(() =>
      store.checkpoint('account-a', 'workspace-a', 'checkpoint-mismatch', first.cursor, first.envelope.revision, {
        ...first.envelope,
        envelopeId: 'different-envelope',
      }),
    ).toThrow('does not match the durable stream object');
  });
});
