import { webcrypto } from 'node:crypto';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { Auth } from '../shared/auth/auth';

import { VaultSession } from './vault-session';
import { VaultSync } from './vault-sync';

describe('vault-owned projection synchronization', () => {
  const owner = { id: 'owner', accountId: 'account', authVersion: 1 };
  const user = signal(owner);
  const generation = signal(1);
  const state = signal('unlocked');
  const fetcher = vi.fn();
  const release = vi.fn();
  let key: CryptoKey;
  let service: VaultSync;
  let onLock: () => void;
  const restore: (() => void)[] = [];
  const change = {
    entityId: 'task',
    entityType: 'work' as const,
    operation: 'upsert' as const,
    revision: 1,
    envelopeId: 'task-envelope',
    actorId: owner.id,
    value: { title: 'Private task' },
  };

  function replace(target: object, property: string, value: unknown): void {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);

    Object.defineProperty(target, property, { configurable: true, value });
    restore.push(() => {
      if (descriptor) Object.defineProperty(target, property, descriptor);
      else Reflect.deleteProperty(target, property);
    });
  }

  beforeEach(async () => {
    user.set({ ...owner });
    generation.set(1);
    state.set('unlocked');
    release.mockReset().mockImplementation((borrower: { lock(): void }) => borrower.lock());
    fetcher.mockReset().mockImplementation(async () => new Response(JSON.stringify({ data: { envelopes: [] } })));
    key = (await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])) as CryptoKey;
    replace(window, 'crypto', webcrypto);
    replace(window, 'indexedDB', new IDBFactory());
    replace(globalThis, 'IDBKeyRange', IDBKeyRange);
    replace(window.navigator, 'locks', { request: async (_name: string, action: () => Promise<unknown>) => action() });
    replace(window, 'fetch', fetcher);
    TestBed.configureTestingModule({
      providers: [
        VaultSync,
        { provide: Auth, useValue: { user, isAuthenticated: signal(true) } },
        {
          provide: VaultSession,
          useValue: {
            state,
            generation,
            borrow: () => key,
            release,
            onLock: (cancel: () => void) => {
              onLock = cancel;

              return () => undefined;
            },
          },
        },
      ],
    });
    service = TestBed.inject(VaultSync);
    TestBed.tick();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    for (const undo of restore.splice(0).reverse()) undo();
  });

  it('authorizes the enrolled workspace at the gateway before restoring plaintext and recreates adapters after locking', async () => {
    await service.attach('workspace', 'device', 1);
    expect(fetcher.mock.calls[0][0]).toContain('/api/sync/workspace/envelopes');
    expect(fetcher.mock.calls[0][0]).toContain('deviceId=device&enrollmentVersion=1');
    await service.stage(change);
    expect(service.projection()?.work[0].value?.['title']).toBe('Private task');
    service.lock();
    expect(service.projection()).toBeNull();
    expect(service.review()).toEqual([]);
    await service.attach('workspace', 'device', 1);
    expect(service.projection()?.work[0].value?.['title']).toBe('Private task');
    expect(service.review()).toEqual([{ envelopeId: change.envelopeId, revision: 1, status: 'pending' }]);
  });

  it('does not publish cached plaintext when device authorization is denied', async () => {
    await service.attach('workspace', 'device', 1);
    await service.stage(change);
    service.lock();
    fetcher.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(service.attach('workspace', 'revoked-device', 1)).rejects.toThrow();
    expect(service.state()).toBe('detached');
    expect(service.projection()).toBeNull();
  });

  it('retains conflicting revisions until an exact explicit reconciliation and never posts plaintext', async () => {
    await service.attach('workspace', 'device', 1);
    await service.stage(change);
    fetcher.mockImplementation(
      async (_url: string, init: RequestInit) =>
        new Response(init.method === 'POST' ? null : JSON.stringify({ data: { envelopes: [] } }), {
          status: init.method === 'POST' ? 409 : 200,
        }),
    );
    await service.synchronize();
    expect(service.review()[0].status).toBe('conflict');
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('Private task');
    await expect(service.discard(change.envelopeId, 2)).rejects.toThrow('reconciliation_required');
    await service.discard(change.envelopeId, 1);
    expect(service.review()).toEqual([]);
    // Discarding a rejected upload does not delete the retained local encrypted projection.
    expect(service.projection()?.work).toHaveLength(1);
  });

  it('aborts in-flight transport and clears decrypted references synchronously on custody lock', async () => {
    await service.attach('workspace', 'device', 1);
    await service.stage(change);
    let complete: ((response: Response) => void) | undefined;

    fetcher.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = service.synchronize();
    const rejected = expect(pending).rejects.toThrow();

    await vi.waitFor(() => expect(complete).toBeDefined());
    const request = fetcher.mock.lastCall?.[1] as RequestInit;

    onLock();
    expect(request.signal?.aborted).toBe(true);
    expect(service.projection()).toBeNull();
    complete?.(new Response(JSON.stringify({ data: { cursor: 1, duplicate: false } })));
    await rejected;
    expect(service.state()).toBe('detached');
    expect(service.projection()).toBeNull();
  });

  it('clears borrowed projections when the user auth-version changes without waiting for another operation', async () => {
    await service.attach('workspace', 'device', 1);
    await service.stage(change);
    user.set({ ...owner, authVersion: 2 });
    TestBed.tick();
    expect(service.projection()).toBeNull();
    expect(service.state()).toBe('detached');
    expect(release).toHaveBeenCalled();
  });

  it('drops decrypted projections on authoritative session or enrollment rejection but retains the encrypted queue', async () => {
    await service.attach('workspace', 'device', 1);
    await service.stage(change);
    fetcher.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(service.synchronize()).rejects.toThrow();
    expect(service.state()).toBe('detached');
    expect(service.projection()).toBeNull();
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ data: { envelopes: [] } })));
    await service.attach('workspace', 'device', 1);
    expect(service.review()).toHaveLength(1);
  });
});
