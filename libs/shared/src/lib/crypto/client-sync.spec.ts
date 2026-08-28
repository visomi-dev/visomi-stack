import { parseEncryptedEnvelope, type EncryptedEnvelope } from './encrypted-envelope';
import {
  AgentSyncAdapter,
  BrowserSyncAdapter,
  MemorySyncStateStore,
  SyncOfflineError,
  mergeProjectionChanges,
  type OpaqueSyncTransport,
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
    await browser.flush(Date.now() + 1000);
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
});
