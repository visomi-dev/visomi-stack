import { parseEncryptedEnvelope, type EncryptedEnvelope } from './encrypted-envelope';
import {
  AgentSyncAdapter,
  BrowserSyncAdapter,
  MemorySyncStateStore,
  SyncOfflineError,
  mergeProjectionChanges,
  type OpaqueSyncTransport,
  SyncTransportError,
  createOpaqueSyncHttpTransport,
} from './client-sync';

function envelope(id: string, revision = 1, tombstone = false): EncryptedEnvelope {
  return parseEncryptedEnvelope({
    format: 'themis.encrypted-envelope',
    version: 1,
    kind: 'sync-object',
    envelopeId: id,
    workspaceId: 'workspace-a',
    recordType: 'projection',
    revision,
    createdAt: '2026-08-20T09:00:00.000Z',
    associatedData: { purpose: 'projection' },
    metadata: tombstone ? { tombstone: 'true' } : { tombstone: 'false' },
    nonce: 'bm9uY2U',
    ciphertext: 'Y2lwaGVydGV4dA',
    authTag: 'dGFn',
  });
}

describe('client opaque sync', () => {
  it('queues offline browser and agent work, then flushes and pulls in cursor order', async () => {
    const appended: EncryptedEnvelope[] = [];
    let online = false;
    const transport: OpaqueSyncTransport = {
      append: async (value) => {
        if (!online) throw new Error('offline');
        appended.push(value);

        return { cursor: appended.length, duplicate: false };
      },
      list: async () => appended.map((value, index) => ({ cursor: index + 1, envelope: value })),
    };
    const browser = new BrowserSyncAdapter('workspace-a', transport, new MemorySyncStateStore(), 1);
    const agent = new AgentSyncAdapter('workspace-a', transport, new MemorySyncStateStore());

    await browser.initialize();
    await agent.initialize();
    await browser.enqueue(envelope('one'));
    await expect(browser.flush()).rejects.toBeInstanceOf(SyncOfflineError);
    online = true;
    await browser.flush(Date.now() + 3000);
    expect((await agent.pull()).map((item) => item.envelopeId)).toEqual(['one']);
  });

  it('retains tombstones and prevents non-resurrection after replay or recovery', async () => {
    const records = [
      { cursor: 1, envelope: envelope('deleted', 1, true) },
      { cursor: 2, envelope: envelope('deleted', 2) },
    ];
    const adapter = new BrowserSyncAdapter(
      'workspace-a',
      { append: async () => ({ cursor: 1, duplicate: true }), list: async () => records },
      new MemorySyncStateStore(),
    );

    expect(await adapter.pull()).toEqual([]);
    expect(adapter.snapshot().tombstones).toEqual(['deleted']);
  });

  it('resolves concurrent changes deterministically and deletion wins ties', () => {
    const result = mergeProjectionChanges([
      { entityId: 'work-1', entityType: 'work', operation: 'upsert', revision: 2, actorId: 'b', envelopeId: 'b-1' },
      { entityId: 'work-1', entityType: 'work', operation: 'delete', revision: 2, actorId: 'a', envelopeId: 'a-1' },
    ]);

    expect(result.work).toEqual([]);
    expect(result.tombstones).toEqual(['work-1']);
  });

  it('persists acknowledgements and exhausted retries even when another transfer is offline', async () => {
    const store = new MemorySyncStateStore();
    const transport: OpaqueSyncTransport = {
      append: async (value) => {
        if (value.envelopeId === 'offline') throw new Error('offline');

        return { cursor: 1, duplicate: false };
      },
      list: async () => [],
    };
    const adapter = new BrowserSyncAdapter('workspace-a', transport, store, 1);

    await adapter.enqueue(envelope('delivered'));
    await adapter.enqueue(envelope('offline'));
    await adapter.enqueue(envelope('also-delivered'));
    await expect(adapter.flush()).rejects.toBeInstanceOf(SyncOfflineError);
    const reopened = new BrowserSyncAdapter('workspace-a', transport, store);

    await reopened.initialize();
    expect(reopened.snapshot().queue).toHaveLength(1);
    expect(reopened.snapshot().queue[0].attempts).toBe(1);
  });

  it('isolates blocked/conflicting revisions without automatically replaying them', async () => {
    const append = jest.fn(async (value: EncryptedEnvelope) => {
      if (value.envelopeId === 'blocked') throw new SyncTransportError(403);
      if (value.envelopeId === 'conflict') throw new SyncTransportError(409);

      return { cursor: 1, duplicate: false };
    });
    const adapter = new BrowserSyncAdapter('workspace-a', { append, list: async () => [] }, new MemorySyncStateStore());

    await adapter.enqueue(envelope('blocked'));
    await adapter.enqueue(envelope('conflict'));
    await adapter.enqueue(envelope('deliverable'));
    expect(await adapter.flush()).toEqual({ sent: 1, pending: 2 });
    await adapter.flush();
    expect(append).toHaveBeenCalledTimes(3);
    expect(adapter.snapshot().queue.map((entry) => entry.status)).toEqual(['blocked', 'conflict']);
    await adapter.discard('conflict', 1);
    expect(adapter.snapshot().queue).toHaveLength(1);
  });

  it('stops on expired authority without consuming retries or losing queued ciphertext', async () => {
    const append = jest.fn(async () => {
      throw new SyncTransportError(401);
    });
    const adapter = new BrowserSyncAdapter('workspace-a', { append, list: async () => [] }, new MemorySyncStateStore());

    await adapter.enqueue(envelope('first'));
    await adapter.enqueue(envelope('second'));
    await expect(adapter.flush()).rejects.toBeInstanceOf(SyncOfflineError);
    expect(append).toHaveBeenCalledTimes(1);
    expect(adapter.snapshot().queue.every((entry) => entry.attempts === 0)).toBe(true);
  });

  it('retains ciphertext without consuming retries after lifecycle cancellation', async () => {
    const append = jest.fn(async () => {
      throw new DOMException('Cancelled', 'AbortError');
    });
    const adapter = new BrowserSyncAdapter('workspace-a', { append, list: async () => [] }, new MemorySyncStateStore());

    await adapter.enqueue(envelope('first'));
    await adapter.enqueue(envelope('second'));
    await expect(adapter.flush()).rejects.toMatchObject({ cause: { name: 'AbortError' } });
    expect(append).toHaveBeenCalledTimes(1);
    expect(adapter.snapshot().queue.every((entry) => entry.attempts === 0)).toBe(true);
  });

  it('refreshes shared state under a lock and rejects ciphertext replacement for a pending revision', async () => {
    const store = new MemorySyncStateStore();
    const transport = { append: async () => ({ cursor: 1, duplicate: false }), list: async () => [] };
    const first = new BrowserSyncAdapter('workspace-a', transport, store);
    const second = new BrowserSyncAdapter('workspace-a', transport, store);

    await Promise.all([first.enqueue(envelope('first')), second.enqueue(envelope('second'))]);
    await first.initialize();
    expect(first.snapshot().queue).toHaveLength(2);
    await first.enqueue(envelope('first'));
    expect(first.snapshot().queue).toHaveLength(2);
    await expect(first.enqueue({ ...envelope('first'), ciphertext: 'different' })).rejects.toThrow(
      'pending encrypted revision',
    );
  });
  it('applies deletions durably before committing the cursor and replays after application failure', async () => {
    const store = new MemorySyncStateStore();
    const records = [
      { cursor: 1, envelope: envelope('first') },
      { cursor: 2, envelope: envelope('deleted', 1, true) },
    ];
    const adapter = new BrowserSyncAdapter(
      'workspace-a',
      {
        append: async () => ({ cursor: 1, duplicate: false }),
        list: async () => records,
      },
      store,
    );
    const apply = jest.fn(async () => {
      throw new Error('Local persistence failed');
    });

    await expect(adapter.pull(apply)).rejects.toThrow('Local persistence failed');
    expect(adapter.snapshot().cursor.value).toBe(0);
    expect(adapter.snapshot().tombstones).toEqual([]);
    expect(apply).toHaveBeenCalledWith(records.map((record) => record.envelope));
    const applied = jest.fn(async () => undefined);

    await adapter.pull(applied);
    expect(adapter.snapshot().cursor.value).toBe(2);
    await adapter.pull(applied);
    expect(applied).toHaveBeenLastCalledWith([]);
  });

  it('blocks already queued revisions when a deletion arrives without silently losing them', async () => {
    const append = jest.fn(async () => ({ cursor: 1, duplicate: false }));
    const adapter = new BrowserSyncAdapter(
      'workspace-a',
      {
        append,
        list: async () => [{ cursor: 1, envelope: envelope('deleted', 3, true) }],
      },
      new MemorySyncStateStore(),
    );

    await adapter.enqueue(envelope('deleted', 2));
    await adapter.pull();
    expect(await adapter.flush()).toEqual({ sent: 0, pending: 1 });
    expect(append).not.toHaveBeenCalled();
    expect(adapter.snapshot().queue[0].status).toBe('blocked');
  });

  it('uses bounded uncached session requests and preserves HTTP status for replay decisions', async () => {
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('', { status: 409 }));
    const transport = createOpaqueSyncHttpTransport({
      baseUrl: '/api',
      workspaceId: 'workspace-a',
      deviceId: 'device',
      enrollmentVersion: 1,
      fetcher,
    });

    await expect(transport.append(envelope('one'))).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/sync/workspace-a/envelopes',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
        method: 'POST',
      }),
    );
  });

  it.each([null, {}, { data: null }, { data: { cursor: 1.5, duplicate: false } }])(
    'rejects malformed acknowledgement %j',
    async (response) => {
      const fetcher = jest
        .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
      const transport = createOpaqueSyncHttpTransport({
        baseUrl: '/api',
        workspaceId: 'workspace-a',
        deviceId: 'device',
        enrollmentVersion: 1,
        fetcher,
      });

      await expect(transport.append(envelope('one'))).rejects.toThrow();
    },
  );

  it.each(['workspace', 'duplicate', 'fractional', 'kind'])(
    'rejects an invalid %s batch without acknowledging any records',
    async (invalid) => {
      const records = [
        { cursor: 1, envelope: envelope('first') },
        { cursor: 2, envelope: envelope('second') },
      ];

      if (invalid === 'workspace') records[1].envelope.workspaceId = 'other';
      if (invalid === 'duplicate') records[1].cursor = 1;
      if (invalid === 'fractional') records[1].cursor = 1.5;
      if (invalid === 'kind') records[1].envelope.kind = 'local-record';
      const adapter = new BrowserSyncAdapter(
        'workspace-a',
        {
          append: async () => ({ cursor: 1, duplicate: false }),
          list: async () => records,
        },
        new MemorySyncStateStore(),
      );
      const apply = jest.fn(async () => undefined);

      await expect(adapter.pull(apply)).rejects.toThrow('Invalid opaque sync batch');
      expect(adapter.snapshot().cursor.value).toBe(0);
      expect(apply).not.toHaveBeenCalled();
    },
  );
});
