import { webcrypto } from 'node:crypto';

import { PinKeyDerivation } from './pin-key-derivation';
import type { PinWorkerRequest } from './pin-worker-contract';

import { localPinEnvelope } from 'shared-crypto';

Object.assign(globalThis, { crypto: webcrypto });

const envelope = localPinEnvelope.parse({
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
});

function worker() {
  return {
    onmessage: null as Worker['onmessage'],
    onerror: null as Worker['onerror'],
    onmessageerror: null as Worker['onmessageerror'],
    postMessage: jest.fn<void, [PinWorkerRequest]>(),
    terminate: jest.fn(),
  };
}

function reply(instance: ReturnType<typeof worker>, data: unknown): void {
  instance.onmessage?.call(instance as unknown as Worker, { data } as MessageEvent<unknown>);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

beforeAll(async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

  Object.assign(globalThis, { CryptoKey: key.constructor });
});

test('returns only a real non-extractable wrapping key and terminates the worker', async () => {
  const instance = worker();
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const derivation = new PinKeyDerivation(() => instance as unknown as Worker);
  const result = derivation.derive('029471', envelope);
  const request = instance.postMessage.mock.calls[0][0];

  expect(request).toMatchObject({ pin: '029471', envelope });
  reply(instance, { id: request.id, key });
  await expect(result).resolves.toBe(key);
  expect(instance.terminate).toHaveBeenCalledTimes(1);
  expect(instance.onmessage).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  derivation.cancel();
  expect(instance.terminate).toHaveBeenCalledTimes(1);
});

test('rejects invalid input before constructing a worker', async () => {
  const create = jest.fn();
  const derivation = new PinKeyDerivation(create);

  await expect(derivation.derive('123', envelope)).rejects.toThrow();
  await expect(derivation.derive('abcdef', envelope)).rejects.toThrow();
  await expect(
    derivation.derive('029471', { ...envelope, version: 2 } as unknown as typeof envelope),
  ).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});

test('rejects mismatched, malformed, extractable and forged key replies', async () => {
  const valid = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const extractable = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrongAlgorithm = await crypto.subtle.generateKey({ name: 'AES-CBC', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const wrongUsage = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);

  for (const response of [
    null,
    { id: 'wrong', key: valid },
    { error: 'pin_derivation_failed' },
    { key: extractable },
    { key: wrongAlgorithm },
    { key: wrongUsage },
    { key: valid, secret: 'unexpected' },
    {
      key: {
        type: 'secret',
        extractable: false,
        algorithm: { name: 'AES-GCM', length: 256 },
        usages: ['encrypt', 'decrypt'],
      },
    },
  ]) {
    const instance = worker();
    const result = new PinKeyDerivation(() => instance as unknown as Worker).derive('029471', envelope);
    const id = instance.postMessage.mock.calls[0][0].id;

    reply(instance, response === null ? null : { id, ...response });
    await expect(result).rejects.toThrow('pin_derivation_failed');
    expect(instance.terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  }
});

test('cancels every pending attempt and ignores late results without cancelling future attempts', async () => {
  const first = worker();
  const second = worker();
  const create = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(worker());
  const derivation = new PinKeyDerivation(create);
  const firstResult = derivation.derive('029471', envelope);
  const secondResult = derivation.derive('029471', envelope);
  const lateReply = first.onmessage;

  derivation.cancel();
  lateReply?.call(first as unknown as Worker, { data: null } as MessageEvent<unknown>);
  await expect(firstResult).rejects.toThrow('pin_derivation_cancelled');
  await expect(secondResult).rejects.toThrow('pin_derivation_cancelled');
  expect(first.terminate).toHaveBeenCalledTimes(1);
  expect(second.terminate).toHaveBeenCalledTimes(1);
  const future = derivation.derive('029471', envelope);

  derivation.cancel();
  await expect(future).rejects.toThrow('pin_derivation_cancelled');
  expect(jest.getTimerCount()).toBe(0);
});

test('supports abort before construction, during construction and while deriving', async () => {
  const aborted = new AbortController();

  aborted.abort();
  const create = jest.fn();

  await expect(new PinKeyDerivation(create).derive('029471', envelope, aborted.signal)).rejects.toThrow(
    'pin_derivation_cancelled',
  );
  expect(create).not.toHaveBeenCalled();
  const controller = new AbortController();
  const instance = worker();
  const pending = new PinKeyDerivation(() => instance as unknown as Worker).derive(
    '029471',
    envelope,
    controller.signal,
  );

  controller.abort();
  await expect(pending).rejects.toThrow('pin_derivation_cancelled');
  expect(instance.terminate).toHaveBeenCalledTimes(1);
  const during = new AbortController();
  const created = worker();
  const construction = new PinKeyDerivation(() => {
    during.abort();

    return created as unknown as Worker;
  });

  await expect(construction.derive('029471', envelope, during.signal)).rejects.toThrow('pin_derivation_cancelled');
  expect(created.postMessage).not.toHaveBeenCalled();
  expect(created.terminate).toHaveBeenCalledTimes(1);
});

test('cleans up timeout, worker errors, message errors and postMessage failures', async () => {
  for (const failure of ['timeout', 'error', 'messageerror', 'post'] as const) {
    const instance = worker();

    if (failure === 'post') {
      instance.postMessage.mockImplementation(() => {
        throw new Error('clone failed');
      });
    }

    const pending = new PinKeyDerivation(() => instance as unknown as Worker).derive('029471', envelope);

    if (failure === 'timeout') {
      jest.advanceTimersByTime(10_000);
    } else if (failure === 'error') {
      instance.onerror?.call(instance as unknown as Worker, new Event('error') as ErrorEvent);
    } else if (failure === 'messageerror') {
      instance.onmessageerror?.call(instance as unknown as Worker, { data: null } as MessageEvent<unknown>);
    }

    await expect(pending).rejects.toThrow(
      failure === 'timeout'
        ? 'pin_worker_timeout'
        : failure === 'messageerror'
          ? 'pin_derivation_failed'
          : 'pin_worker_unavailable',
    );
    expect(instance.terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  }

  await expect(
    new PinKeyDerivation(() => {
      throw new Error('CSP blocked worker');
    }).derive('029471', envelope),
  ).rejects.toThrow('pin_worker_unavailable');
});
