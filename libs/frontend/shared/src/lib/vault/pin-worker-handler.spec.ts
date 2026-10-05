import { webcrypto } from 'node:crypto';

import { createPinWorkerHandler } from './pin-worker-handler';
import type { PinWorkerResponse } from './pin-worker-contract';

import { localPinEnvelope } from 'shared-crypto';
import { derivePinWrappingKey } from 'shared-crypto/vault-pin';

jest.mock('shared-crypto/vault-pin', () => ({ derivePinWrappingKey: jest.fn() }));

const request = {
  id: '55555555-5555-4555-8555-555555555555',
  pin: '029471',
  envelope: localPinEnvelope.parse({
    version: 1,
    kdfProfile: 'pin-argon2id-hkdf-sha256-v1',
    binding: {
      ownerUserId: '11111111-1111-4111-8111-111111111111',
      personalScopeId: '22222222-2222-4222-8222-222222222222',
      methodId: '44444444-4444-4444-8444-444444444444',
      methodKind: 'local-pin',
      browserId: '33333333-3333-4333-8333-333333333333',
      keyGeneration: 1,
    },
    hkdfSalt: 'A'.repeat(43),
    argon2Salt: 'A'.repeat(22),
    iv: 'A'.repeat(16),
    ciphertext: 'A'.repeat(64),
  }),
};

beforeEach(() => jest.resetAllMocks());

test('validates untrusted requests without deriving or echoing sensitive input', async () => {
  const respond = jest.fn<void, [PinWorkerResponse]>();
  const handle = createPinWorkerHandler(webcrypto as unknown as Crypto, respond);

  for (const input of [null, { ...request, pin: 'bad' }, { ...request, extra: 'secret' }, { ...request, id: 'bad' }]) {
    await handle(input);
  }

  expect(derivePinWrappingKey).not.toHaveBeenCalled();
  expect(respond.mock.calls).toEqual(Array.from({ length: 4 }, () => [{ error: 'pin_worker_invalid_request' }]));
});

test('rejects concurrent work and returns only a correlated key', async () => {
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  let complete!: (key: CryptoKey) => void;

  jest.mocked(derivePinWrappingKey).mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const respond = jest.fn<void, [PinWorkerResponse]>();
  const handle = createPinWorkerHandler(webcrypto as unknown as Crypto, respond);
  const pending = handle(request);

  await handle(request);
  expect(derivePinWrappingKey).toHaveBeenCalledTimes(1);
  expect(respond).toHaveBeenLastCalledWith({ error: 'pin_worker_invalid_request' });
  complete(key as CryptoKey);
  await pending;
  expect(respond).toHaveBeenLastCalledWith({ id: request.id, key });
});

test('sanitizes derivation errors and releases the busy guard after failure', async () => {
  jest.mocked(derivePinWrappingKey).mockRejectedValue(new Error('PIN 029471 secret backend detail'));
  const respond = jest.fn<void, [PinWorkerResponse]>();
  const handle = createPinWorkerHandler(webcrypto as unknown as Crypto, respond);

  await handle(request);
  await handle(request);
  expect(derivePinWrappingKey).toHaveBeenCalledTimes(2);
  expect(respond.mock.calls).toEqual([
    [{ id: request.id, error: 'pin_derivation_failed' }],
    [{ id: request.id, error: 'pin_derivation_failed' }],
  ]);
});
