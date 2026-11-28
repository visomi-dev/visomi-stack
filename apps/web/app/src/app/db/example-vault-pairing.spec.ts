import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { VaultError, type DeviceProof, type SigningPin } from '@visomi-stack/shared-db';
import { WebCryptoDevices, encodeBytes } from '@visomi-stack/web-frontend-db';
import { afterEach, expect, it, vi } from 'vitest';

import { Session } from '../auth/session/session';
import { AuthHttp } from '../auth/shared/http';
import { ClientDatabase } from '../shared/db/database';
import { DatabaseHttp } from '../shared/db/http';
import { UnlockCapabilities } from '../shared/vault/unlock-capabilities';
import { VaultSession } from '../shared/vault/vault-session';

import { ExamplePairingEnrollment } from './example-pairing-enrollment';
import { ExamplePairingDraft } from './example-pairing-draft';
import { ExamplePairingExchange } from './example-pairing-exchange';
import { ExampleVaultPairing } from './example-vault-pairing';

const id = (last: number) => `00000000-0000-4000-8000-00000000000${last}`;
const bytes = (length: number) => encodeBytes(new Uint8Array(length));
const target = { tenantId: id(1), scopeId: id(2), objectId: id(3) };
const signer: SigningPin = { deviceId: id(4), signing: bytes(91) };
const proof = {
  format: 'visomi.device-enrollment',
  version: 1,
  ownerId: id(5),
  deviceId: id(6),
  requestId: id(7),
  challenge: bytes(32),
  expiresAt: '2030-01-01T00:00:00.000Z',
  key: {
    product: 'test',
    domain: 'private-resources',
    scope: { kind: 'resource', tenantId: target.tenantId, groupId: id(8), resourceId: target.scopeId },
    generation: 1,
  },
  keys: { signing: bytes(91), encryption: bytes(422) },
  proof: bytes(64),
} as const satisfies DeviceProof;

afterEach(() => vi.restoreAllMocks());

async function setup(recipient = false) {
  const cancellation = new AbortController();
  const api = { vault: vi.fn().mockResolvedValue(proof) };

  vi.spyOn(ExamplePairingEnrollment.prototype, 'roster').mockResolvedValue({
    key: proof.key,
    epoch: 1,
    phase: 'ready',
    devices: [],
  });

  const context = {
    key: proof.key,
    ownerId: proof.ownerId,
    deviceId: signer.deviceId,
    origin: 'http://localhost',
    method: 'pin-argon2id',
    methodId: 'synthetic-method',
  } as const;

  vi.spyOn(ExamplePairingEnrollment.prototype, 'registeredBinding').mockResolvedValue(recipient ? undefined : context);

  if (recipient) {
    vi.spyOn(ExamplePairingDraft.prototype, 'resume').mockResolvedValue({
      context: { ...context, deviceId: proof.deviceId },
      proof,
      fingerprint: 'synthetic-fingerprint',
      token: '',
      reviewLink: 'https://example.test/security',
      authenticatedSigner: undefined,
    });
  }

  vi.spyOn(WebCryptoDevices.prototype, 'verify').mockResolvedValue(true);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      ExampleVaultPairing,
      { provide: AuthHttp, useValue: {} },
      { provide: DatabaseHttp, useValue: api },
      { provide: ClientDatabase, useValue: {} },
      { provide: UnlockCapabilities, useValue: {} },
      {
        provide: Session,
        useValue: { user: () => ({ id: proof.ownerId }), full: () => true, cancellation: () => cancellation.signal },
      },
      {
        provide: VaultSession,
        useValue: { cancellation: () => cancellation.signal, canResume: () => true, lockContext: vi.fn() },
      },
    ],
  });

  const pairing = TestBed.inject(ExampleVaultPairing);

  await pairing.initialize(target, 'localhost', true);

  return { pairing, api };
}

it('deletes the server request after reload discards the recipient code', async () => {
  const { pairing, api } = await setup(true);

  expect(pairing.recipientEnd()).toBe('unconfirmed');
  expect(api.vault).toHaveBeenCalledExactlyOnceWith(
    `/tenants/${target.tenantId}/scopes/${target.scopeId}/domains/private-resources/devices/pairing/${proof.requestId}`,
    undefined,
    undefined,
    'DELETE',
  );
});

it('closes an expired or retired review and will load a fresh request', async () => {
  const { pairing, api } = await setup();
  const view = new AbortController().signal;

  api.vault.mockRejectedValueOnce(new HttpErrorResponse({ status: 404, error: { error: 'device_challenge_invalid' } }));

  await pairing.loadReview(proof.requestId, view);

  expect(pairing.reviewFailure()).toBe('ended');
  expect(pairing.reviewProof()).toBeNull();
  api.vault.mockResolvedValueOnce({ ...proof, expiresAt: '2000-01-01T00:00:00.000Z' });

  await pairing.loadReview(proof.requestId, view);

  expect(pairing.reviewFailure()).toBe('ended');
  expect(pairing.reviewProof()).toBeNull();

  await pairing.loadReview(proof.requestId, view);

  expect(pairing.reviewFailure()).toBeNull();
  expect(pairing.reviewProof()).toEqual(proof);
});

it('clears the approver form after the exchange ends and blocks another submission', async () => {
  const { pairing } = await setup();

  vi.spyOn(ExamplePairingEnrollment.prototype, 'approve').mockImplementation(
    async (_proof, _owner, _signal, _existing, verify) => {
      if (typeof verify === 'function') {
        await verify(signer);
      }

      return 'approved';
    },
  );

  let endExchange!: (error: unknown) => void;
  const outcome = new Promise<void>((_, reject) => {
    endExchange = reject;
  });
  const verify = vi.spyOn(ExamplePairingExchange.prototype, 'authenticateRecipient').mockReturnValue(outcome);

  await pairing.loadReview(proof.requestId, new AbortController().signal);

  const approval = pairing.approveReview('1234 5678');

  expect(pairing.busy()).toBe(true);
  expect(pairing.reviewFailure()).toBeNull();
  endExchange(new VaultError('unavailable'));

  await approval;

  expect(pairing.reviewFailure()).toBe('ended');
  expect(pairing.reviewProof()).toBeNull();
  expect(pairing.busy()).toBe(false);

  await pairing.approveReview('12345678');

  expect(verify).toHaveBeenCalledOnce();
});
