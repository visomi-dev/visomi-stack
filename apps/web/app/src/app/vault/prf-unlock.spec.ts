import { webcrypto } from 'node:crypto';

import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';

import { Auth } from '../shared/auth/auth';
import type { AuthUser } from '../shared/auth/auth.models';
import { Passkey } from '../shared/auth/passkey';

import { evaluateVaultPrf } from './passkey-unlock';
import { PrfUnlock } from './prf-unlock';
import { VaultSession } from './vault-session';

import { sealVaultKey } from 'shared-crypto';
import type { VaultKeyEnvelopeMetadata } from 'shared-crypto';

describe('route-owned PRF custody ceremonies', () => {
  const owner: AuthUser = {
    id: '67429346-804a-4bb1-a832-b06a0be39bb1',
    accountId: 'eaa11fea-b03d-46a2-b327-c55d9b09fd5a',
    email: 'person@example.test',
    role: 'owner',
    emailVerifiedAt: null,
    authVersion: 1,
  };
  const user = signal<AuthUser | null>(owner);
  const generation = signal(1);
  const authenticated = signal(true);
  const getCredential = vi.fn();
  const post = vi.fn();
  const get = vi.fn();
  const unlockEnvelope = vi.fn(async () => undefined);
  const wrap = vi.fn(async (key: CryptoKey, metadata: VaultKeyEnvelopeMetadata) =>
    sealVaultKey(webcrypto as unknown as Crypto, key, new Uint8Array(32).fill(42), metadata),
  );
  const cancellations = new Set<() => void>();
  const begun = {
    challengeId: '15eec2ec-cc52-4b81-a232-160dacd0c409',
    methodId: '86f22594-256d-4141-9c26-d68b501c8e3c',
    credentialId: 'AQ',
    prfInput: 'A'.repeat(43),
    options: { challenge: 'AQ', rpId: 'localhost' },
    expiresAt: '2026-10-04T01:00:00Z',
  };
  let service: PrfUnlock;
  let output: Uint8Array<ArrayBuffer>;
  let restoreCrypto: () => void;

  function credential(id = 'AQ'): Credential {
    return {
      id,
      type: 'public-key',
      rawId: new Uint8Array([1]).buffer,
      response: {
        clientDataJSON: new Uint8Array([1]).buffer,
        authenticatorData: new Uint8Array([1]).buffer,
        signature: new Uint8Array([1]).buffer,
        userHandle: null,
      },
      getClientExtensionResults: () => ({ prf: { results: { first: output.buffer } } }),
    } as unknown as Credential;
  }

  beforeEach(() => {
    const original = Object.getOwnPropertyDescriptor(window, 'crypto');

    Object.defineProperty(window, 'crypto', { configurable: true, value: webcrypto });
    restoreCrypto = () => {
      if (original) Object.defineProperty(window, 'crypto', original);
    };
    user.set({ ...owner });
    generation.set(1);
    authenticated.set(true);
    cancellations.clear();
    output = new Uint8Array(32).fill(7);
    getCredential.mockReset().mockImplementation(async () => credential());
    post.mockReset().mockImplementation((url: string) =>
      of({
        data: url.endsWith('/begin')
          ? begun
          : url.endsWith('/complete')
            ? { purpose: 'enroll', enrollmentProofId: begun.challengeId }
            : { methodId: begun.methodId, revision: 1 },
      }),
    );
    get.mockReset().mockReturnValue(of({ data: [] }));
    wrap.mockClear();
    unlockEnvelope.mockReset().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        PrfUnlock,
        { provide: Auth, useValue: { user, isAuthenticated: authenticated } },
        { provide: Passkey, useValue: { getCredential } },
        { provide: HttpClient, useValue: { post, get } },
        {
          provide: VaultSession,
          useValue: {
            generation,
            borrow: () => ({}),
            release: (borrower: { lock(): void }) => borrower.lock(),
            onLock: (cancel: () => void) => {
              cancellations.add(cancel);

              return () => cancellations.delete(cancel);
            },
            wrap,
            unlockEnvelope,
          },
        },
      ],
    });
    service = TestBed.inject(PrfUnlock);
    TestBed.tick();
  });
  afterEach(() => {
    service.cancel();
    TestBed.resetTestingModule();
    restoreCrypto();
  });

  it('enrolls only a round-trip-validated envelope and never sends PRF extension results', async () => {
    await service.enroll('AQ', '62b309ef-2d46-4d5a-b895-df108412c84f');
    expect(post).toHaveBeenCalledTimes(3);
    const complete = post.mock.calls[1][1];

    expect(complete.response).not.toHaveProperty('clientExtensionResults');
    expect(JSON.stringify(post.mock.calls)).not.toContain('prfOutput');
    expect(wrap).toHaveBeenCalledOnce();
    expect(output.every((value) => value === 0)).toBe(true);
    expect(getCredential).toHaveBeenCalledWith(
      expect.objectContaining({ userVerification: 'required' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('clears unsupported and wrong-credential output without sending a completion', async () => {
    getCredential.mockResolvedValueOnce(credential('Ag'));
    await expect(service.enroll('AQ', '62b309ef-2d46-4d5a-b895-df108412c84f')).rejects.toThrow(
      'vault_passkey_mismatch',
    );
    expect(output.every((value) => value === 0)).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    output = new Uint8Array(16).fill(7);
    await expect(service.enroll('AQ', '62b309ef-2d46-4d5a-b895-df108412c84f')).rejects.toThrow('vault_prf_unavailable');
    expect(output.every((value) => value === 0)).toBe(true);
  });

  it('drops late credential output after cancellation even if the browser ignores abort', async () => {
    let resolve: (value: Credential) => void = () => undefined;

    getCredential.mockImplementationOnce(
      () =>
        new Promise<Credential>((done) => {
          resolve = done;
        }),
    );
    const operation = service.enroll('AQ', '62b309ef-2d46-4d5a-b895-df108412c84f');
    const rejected = expect(operation).rejects.toThrow('vault_unlock_cancelled');

    await vi.waitFor(() => expect(getCredential).toHaveBeenCalledOnce());
    service.cancel();
    resolve(credential());
    await rejected;
    expect(output.every((value) => value === 0)).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects an owner change while server verification is pending and erases secret output', async () => {
    const pending = new Subject<unknown>();

    post.mockImplementation((url: string) => (url.endsWith('/complete') ? pending : of({ data: begun })));
    const operation = service.enroll('AQ', '62b309ef-2d46-4d5a-b895-df108412c84f');
    const rejected = expect(operation).rejects.toThrow();

    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    user.set({ ...owner, authVersion: 2 });
    TestBed.tick();
    await rejected;
    expect(output.every((value) => value === 0)).toBe(true);
    expect(wrap).not.toHaveBeenCalled();
  });

  it('rejects a ciphertext response for a different method before installing keys', async () => {
    const envelope = await sealVaultKey(
      webcrypto as unknown as Crypto,
      await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
      new Uint8Array(32),
      {
        version: 1,
        kdfProfile: 'prf-hkdf-sha256-v1',
        hkdfSalt: 'A'.repeat(43),
        prfInput: begun.prfInput,
        binding: {
          ownerUserId: owner.id,
          personalScopeId: owner.accountId,
          methodId: webcrypto.randomUUID(),
          methodKind: 'passkey-prf',
          credentialId: 'AQ',
          keyGeneration: 1,
        },
      },
    );

    post.mockImplementation((url: string) =>
      of({ data: url.endsWith('/begin') ? begun : { purpose: 'unlock', envelope } }),
    );
    await expect(service.unlock(begun.methodId)).rejects.toThrow('vault_passkey_mismatch');
    expect(unlockEnvelope).not.toHaveBeenCalled();
    expect(output.every((value) => value === 0)).toBe(true);
  });

  it('clears output returned after a custody lock before completing an assertion', async () => {
    getCredential.mockImplementationOnce(async () => {
      generation.update((value) => value + 1);
      for (const cancel of cancellations) cancel();

      return credential();
    });
    await expect(service.unlock(begun.methodId)).rejects.toThrow('vault_unlock_cancelled');
    expect(output.every((value) => value === 0)).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to weak secrets when the authenticator has no PRF output', async () => {
    getCredential.mockResolvedValueOnce({ ...credential(), getClientExtensionResults: () => ({}) });
    await expect(
      evaluateVaultPrf(TestBed.inject(Passkey), begun.options, 'AQ', begun.prfInput, new AbortController().signal),
    ).rejects.toThrow('vault_prf_unavailable');
  });
});
