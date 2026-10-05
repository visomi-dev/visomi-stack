import { webcrypto } from 'node:crypto';

import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { from, of, Subject } from 'rxjs';

import { Auth } from '../shared/auth/auth';

import { BrowserUnlock } from './browser-unlock';
import { VaultSession } from './vault-session';

import { browserVaultFingerprint } from 'shared-crypto';
import type { BrowserVaultPairing } from 'shared-crypto';

describe('temporary browser recipient custody', () => {
  const owner = {
    id: '67429346-804a-4bb1-a832-b06a0be39bb1',
    accountId: 'eaa11fea-b03d-46a2-b327-c55d9b09fd5a',
    authVersion: 1,
  };
  const user = signal(owner);
  const generation = signal(1);
  const state = signal('locked');
  const post = vi.fn();
  const get = vi.fn();
  const remove = vi.fn();
  const lock = vi.fn();
  const unlockBrowserDelivery = vi.fn();
  const deliverToBrowser = vi.fn();
  const release = vi.fn();
  let service: BrowserUnlock;
  let restoreCrypto: () => void;
  let pairing: BrowserVaultPairing;
  let fingerprint: string;

  beforeEach(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'crypto');

    Object.defineProperty(window, 'crypto', { configurable: true, value: webcrypto });
    restoreCrypto = () => {
      if (descriptor) Object.defineProperty(window, 'crypto', descriptor);
    };
    user.set({ ...owner });
    state.set('locked');
    generation.set(1);
    lock.mockReset();
    release.mockReset();
    unlockBrowserDelivery.mockReset().mockResolvedValue(undefined);
    deliverToBrowser.mockReset().mockResolvedValue({ version: 1, ciphertext: 'A'.repeat(512) });
    post.mockReset().mockImplementation((_url: string, body: { pairing: BrowserVaultPairing }) => {
      pairing = body.pairing;

      return from(
        browserVaultFingerprint(webcrypto as unknown as Crypto, pairing).then((value) => {
          fingerprint = value;

          return { data: { requestId: pairing.requestId, fingerprint: value, expiresAt: pairing.expiresAt } };
        }),
      );
    });
    get.mockReset();
    remove.mockReset().mockReturnValue(of({}));
    TestBed.configureTestingModule({
      providers: [
        BrowserUnlock,
        { provide: Auth, useValue: { user, isAuthenticated: signal(true) } },
        { provide: HttpClient, useValue: { post, get, delete: remove } },
        {
          provide: VaultSession,
          useValue: { generation, state, onLock: () => release, lock, unlockBrowserDelivery, deliverToBrowser },
        },
      ],
    });
    service = TestBed.inject(BrowserUnlock);
    TestBed.tick();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    restoreCrypto();
    vi.useRealTimers();
  });

  it('creates owned signed metadata and discards recipient keys before remote cancellation', async () => {
    await service.begin();
    const request = service.request();

    expect(request?.requestId).toBe(pairing.requestId);
    expect(pairing.ownerUserId).toBe(owner.id);
    expect(pairing.personalScopeId).toBe(owner.accountId);
    expect(post.mock.calls[0][1]).not.toHaveProperty('privateKey');
    service.cancel();
    expect(service.request()).toBeNull();
    expect(remove).toHaveBeenCalledWith(
      `/api/vault-unlock/${owner.accountId}/browser-enrollments/${request?.requestId}`,
    );
    await expect(service.receive()).rejects.toThrow('vault_enrollment_unavailable');
  });

  it('rejects a server-substituted fingerprint and cancels the original signed request', async () => {
    post.mockImplementation((_url: string, body: { pairing: BrowserVaultPairing }) =>
      of({
        data: {
          requestId: body.pairing.requestId,
          fingerprint: 'A'.repeat(43),
          expiresAt: body.pairing.expiresAt,
        },
      }),
    );
    await expect(service.begin()).rejects.toThrow('vault_enrollment_mismatch');
    expect(service.request()).toBeNull();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('never installs a late ciphertext after cancellation while consumption is pending', async () => {
    await service.begin();
    const pending = new Subject<unknown>();

    post.mockReturnValue(pending);
    const operation = service.receive();
    const rejected = expect(operation).rejects.toThrow();

    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    service.cancel();
    pending.next({ data: { version: 1, ciphertext: 'A'.repeat(512) } });
    pending.complete();
    await rejected;
    expect(unlockBrowserDelivery).not.toHaveBeenCalled();
    expect(service.request()).toBeNull();
  });

  it('drops temporary keys on owner-version change and prevents departing-owner consumption', async () => {
    await service.begin();
    user.set({ ...owner, authVersion: 2 });
    TestBed.tick();
    expect(service.request()).toBeNull();
    await expect(service.receive()).rejects.toThrow('vault_enrollment_unavailable');
    expect(unlockBrowserDelivery).not.toHaveBeenCalled();
  });

  it('verifies pairing and comparison code before approval and sends only recipient ciphertext with a grant', async () => {
    await service.begin();
    get.mockReturnValue(of({ data: { pairing, fingerprint, approved: false } }));
    await expect(service.inspect(pairing.requestId, 'A'.repeat(43))).rejects.toThrow('vault_enrollment_mismatch');
    const recipient = await service.inspect(pairing.requestId, fingerprint);

    post.mockReturnValue(of({}));
    state.set('unlocked');
    await service.approve(recipient, 'management-grant');
    expect(deliverToBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: owner.id,
        personalScopeId: owner.accountId,
        requestId: pairing.requestId,
        fingerprint,
        recipientEncryption: pairing.keys.encryption,
      }),
    );
    expect(post.mock.lastCall?.[1]).toEqual({
      fingerprint,
      envelope: { version: 1, ciphertext: 'A'.repeat(512) },
      grantId: 'management-grant',
    });
  });

  it('locks custody if cancellation happens during key installation', async () => {
    await service.begin();
    post.mockReturnValue(of({ data: { version: 1, ciphertext: 'A'.repeat(512) } }));
    let finish: (() => void) | undefined;

    unlockBrowserDelivery.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const operation = service.receive();
    const rejected = expect(operation).rejects.toThrow('vault_locked');

    await vi.waitFor(() => expect(unlockBrowserDelivery).toHaveBeenCalledOnce());
    service.cancel();
    expect(lock).toHaveBeenCalled();
    finish?.();
    await rejected;
    expect(service.request()).toBeNull();
  });

  it('expires the temporary signing/encryption identity after ten minutes', async () => {
    vi.useFakeTimers();
    await service.begin();
    expect(service.request()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(service.request()).toBeNull();
    await expect(service.receive()).rejects.toThrow('vault_enrollment_unavailable');
  });
});
