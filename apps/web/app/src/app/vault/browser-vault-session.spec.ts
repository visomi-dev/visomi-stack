import { webcrypto } from 'node:crypto';

import { signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { TestBed } from '@angular/core/testing';

import { Auth } from '../shared/auth/auth';
import type { AuthUser } from '../shared/auth/auth.models';

import { BrowserVaultSession } from './browser-vault-session';
import { ServerVaultSession } from './server-vault-session';

import { derivePrfWrappingKey, encodeRecoveryBytes, sealVaultKey, sealVaultPinProfile } from 'shared-crypto';

describe('application vault key lifecycle', () => {
  const user = signal<AuthUser | null>(null);
  const authenticated = signal(true);
  const ensureSessionLoaded = vi.fn(async () => undefined);
  const get = vi.fn(() => of<unknown>({ data: null }));
  const post = vi.fn(() => of<unknown>({ data: { authorized: true } }));
  const owner: AuthUser = {
    id: '67429346-804a-4bb1-a832-b06a0be39bb1',
    accountId: 'eaa11fea-b03d-46a2-b327-c55d9b09fd5a',
    email: 'person@example.test',
    role: 'owner',
    emailVerifiedAt: null,
    authVersion: 1,
  };
  const recovery = encodeRecoveryBytes(new Uint8Array(32).fill(42));
  let vault: BrowserVaultSession;
  let stop: (() => void) | undefined;
  let restoreCrypto: () => void;

  beforeEach(() => {
    const original = Object.getOwnPropertyDescriptor(window, 'crypto');

    Object.defineProperty(window, 'crypto', { configurable: true, value: webcrypto });
    restoreCrypto = () => {
      if (original) Object.defineProperty(window, 'crypto', original);
    };
    user.set({ ...owner });
    authenticated.set(true);
    ensureSessionLoaded.mockReset().mockResolvedValue(undefined);
    get.mockReset().mockReturnValue(of({ data: null }));
    post.mockReset().mockReturnValue(of({ data: { authorized: true } }));
    TestBed.configureTestingModule({
      providers: [
        { provide: Auth, useValue: { user, isAuthenticated: authenticated, ensureSessionLoaded } },
        { provide: HttpClient, useValue: { get, post } },
      ],
    });
    vault = TestBed.inject(BrowserVaultSession);
    TestBed.tick();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    TestBed.resetTestingModule();
    restoreCrypto();
    vi.useRealTimers();
  });

  it('stays locked after sign-in and installs only non-extractable keys after forced session validation', async () => {
    expect(vault.state()).toBe('locked');
    await vault.unlockRecovery(recovery);
    const borrower = { lock: vi.fn() };
    const key = vault.borrow(borrower);

    expect(ensureSessionLoaded).toHaveBeenCalledWith(true);
    expect(key.extractable).toBe(false);
    await expect(webcrypto.subtle.exportKey('raw', key)).rejects.toThrow();
    vault.lock();
    expect(borrower.lock).toHaveBeenCalledOnce();
    expect(() => vault.borrow(borrower)).toThrow('vault_locked');
  });

  it('retains an unlocked key across refreshed identity objects with the same authoritative version', async () => {
    ensureSessionLoaded.mockImplementation(async () => {
      user.set({ ...owner });
    });
    await vault.unlockRecovery(recovery);
    TestBed.tick();
    expect(vault.state()).toBe('unlocked');
    user.set({ ...owner, email: 'updated@example.test' });
    TestBed.tick();
    expect(vault.state()).toBe('unlocked');
  });

  it('rechecks a PRF source at installation and locks its borrowers when the method is revoked', async () => {
    const binding = {
      ownerUserId: owner.id,
      personalScopeId: owner.accountId,
      methodId: '4848dd5b-dbbd-41a4-8b22-31514d1b8086',
      methodKind: 'passkey-prf' as const,
      credentialId: 'AQ',
      keyGeneration: 1 as const,
    };
    const key = await derivePrfWrappingKey(
      webcrypto as unknown as Crypto,
      new Uint8Array(32).fill(7),
      binding,
      'A'.repeat(43),
    );
    const envelope = await sealVaultKey(webcrypto as unknown as Crypto, key, new Uint8Array(32).fill(42), {
      version: 1,
      kdfProfile: 'prf-hkdf-sha256-v1',
      binding,
      hkdfSalt: 'A'.repeat(43),
      prfInput: 'A'.repeat(43),
    });
    let active = true;

    get.mockImplementation((...args: unknown[]) =>
      of({
        data: String(args[0]).endsWith('/methods')
          ? active
            ? [{ methodId: binding.methodId }]
            : []
          : String(args[0]).endsWith('/config')
            ? { pinMethodId: null }
            : null,
      }),
    );
    await vault.unlockEnvelope(envelope, key, vault.generation());
    expect(vault.state()).toBe('unlocked');
    const borrower = { lock: vi.fn() };

    vault.borrow(borrower);
    stop = vault.startLifecycle();
    active = false;
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(vault.state()).toBe('locked'));
    expect(borrower.lock).toHaveBeenCalledOnce();
  });

  it('does not install a PRF key when the method was revoked after assertion delivery', async () => {
    const binding = {
      ownerUserId: owner.id,
      personalScopeId: owner.accountId,
      methodId: '4848dd5b-dbbd-41a4-8b22-31514d1b8086',
      methodKind: 'passkey-prf' as const,
      credentialId: 'AQ',
      keyGeneration: 1 as const,
    };
    const key = await derivePrfWrappingKey(
      webcrypto as unknown as Crypto,
      new Uint8Array(32).fill(7),
      binding,
      'A'.repeat(43),
    );
    const envelope = await sealVaultKey(webcrypto as unknown as Crypto, key, new Uint8Array(32).fill(42), {
      version: 1,
      kdfProfile: 'prf-hkdf-sha256-v1',
      binding,
      hkdfSalt: 'A'.repeat(43),
      prfInput: 'A'.repeat(43),
    });

    get.mockImplementation((...args: unknown[]) => of({ data: String(args[0]).endsWith('/methods') ? [] : null }));
    await expect(vault.unlockEnvelope(envelope, key, vault.generation())).rejects.toThrow('vault_method_unavailable');
    expect(vault.state()).toBe('locked');
  });

  it.each(['account', 'user', 'version', 'logout'])(
    'locks consumers and cancels work after %s changes',
    async (kind) => {
      await vault.unlockRecovery(recovery);
      const borrower = { lock: vi.fn() };
      const cancel = vi.fn();

      vault.borrow(borrower);
      vault.onLock(cancel);
      if (kind === 'logout') authenticated.set(false);
      else
        user.set({
          ...owner,
          ...(kind === 'account' ? { accountId: 'other' } : kind === 'user' ? { id: 'other' } : { authVersion: 2 }),
        });
      TestBed.tick();
      expect(vault.state()).toBe('locked');
      expect(borrower.lock).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it('rejects a late unlock result after a manual lock without resurrecting keys', async () => {
    let resolve = () => undefined;

    ensureSessionLoaded.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const pending = vault.unlockRecovery(recovery);

    vault.lock();
    resolve();
    await expect(pending).rejects.toThrow('vault_locked');
    expect(vault.state()).toBe('locked');
  });

  it('fails closed on a forced lookup failure while the account identity remains available', async () => {
    ensureSessionLoaded.mockRejectedValue(new Error('network_unavailable'));
    await expect(vault.unlockRecovery(recovery)).rejects.toThrow('network_unavailable');
    expect(vault.state()).toBe('locked');
    expect(user()).not.toBeNull();
  });

  it('cancels all consumers even when one cleanup throws', async () => {
    await vault.unlockRecovery(recovery);
    vault.borrow({
      lock: () => {
        throw new Error('consumer_failed');
      },
    });
    const next = { lock: vi.fn() };
    const cancel = vi.fn();

    vault.borrow(next);
    vault.onLock(() => {
      throw new Error('worker_failed');
    });
    vault.onLock(cancel);
    vault.lock();
    expect(next.lock).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('locks after idle expiry before allowing another borrow and on page exit', async () => {
    await vault.unlockRecovery(recovery);
    stop = vault.startLifecycle();
    const elapsed = window.performance.now();
    const clock = vi.spyOn(window.performance, 'now').mockReturnValue(elapsed + 15 * 60_000);

    expect(() => vault.borrow({ lock: vi.fn() })).toThrow('vault_locked');
    clock.mockRestore();
    await vault.unlockRecovery(recovery);
    window.dispatchEvent(new Event('pagehide'));
    expect(vault.state()).toBe('locked');
  });

  it('locks on failed authority validation when returning to the app', async () => {
    stop = vault.startLifecycle();
    await vault.unlockRecovery(recovery);
    ensureSessionLoaded.mockRejectedValue(new Error('revoked'));
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => vault.state()).toBe('locked');
  });

  it('provides a deterministic locked server implementation', async () => {
    const server = TestBed.inject(ServerVaultSession);

    expect(server.state()).toBe('locked');
    await expect(server.unlockRecovery(recovery)).rejects.toThrow('vault_locked');
    expect(() => server.borrow({ lock: vi.fn() })).toThrow('vault_locked');
  });

  it('rejects an unrelated recovery key instead of silently replacing the canonical PIN key', async () => {
    const dataKey = await webcrypto.subtle.importKey('raw', new Uint8Array(32).fill(42), 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
    const profile = await sealVaultPinProfile(webcrypto as unknown as Crypto, dataKey, '829374', {
      ownerUserId: owner.id,
      personalScopeId: owner.accountId,
      methodId: '4848dd5b-dbbd-41a4-8b22-31514d1b8086',
    });

    get.mockReturnValue(of({ data: profile }));
    await expect(vault.unlockRecovery(encodeRecoveryBytes(new Uint8Array(32).fill(13)))).rejects.toThrow();
    expect(vault.state()).toBe('locked');
    await vault.unlockRecovery(recovery);
    expect(vault.state()).toBe('unlocked');
  });

  it('requires purpose-bound server authorization for recovery export and cancels a late authorization', async () => {
    await vault.unlockRecovery(recovery);
    expect(await vault.exportRecovery('grant')).toBe(recovery);
    expect(post).toHaveBeenCalledWith(`/api/vault-unlock/${owner.accountId}/recovery-export`, { grantId: 'grant' });
    const authorization = new Subject<unknown>();

    post.mockReturnValue(authorization);
    const pending = vault.exportRecovery('next-grant');

    vault.lock();
    authorization.next({ data: { authorized: true } });
    await expect(pending).rejects.toThrow();
    expect(vault.state()).toBe('locked');
  });
});
