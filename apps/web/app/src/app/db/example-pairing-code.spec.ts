import { HttpErrorResponse } from '@angular/common/http';
import {
  type DeviceProof,
  type PairingCodeExchange,
  type PairingCodeMessage,
  type SigningPin,
  pairingCodeExchangeSchema,
} from '@visomi-stack/shared-db';
import { encodeBytes } from '@visomi-stack/web-frontend-db';
import { expect, it, vi } from 'vitest';

import {
  ApproverPairingCode,
  RecipientPairingCode,
  generatePairingCode,
  pairingCodeIdentifiers,
} from './example-pairing-code';
import { ExamplePairingExchange } from './example-pairing-exchange';

const id = (last: string) => `00000000-0000-4000-8000-00000000000${last}`;
const bytes = (length: number, fill = 0) => encodeBytes(new Uint8Array(length).fill(fill));
const proof = {
  format: 'visomi.device-enrollment',
  version: 1,
  ownerId: id('1'),
  deviceId: id('2'),
  requestId: id('3'),
  challenge: bytes(32),
  expiresAt: '2030-01-01T00:00:00.000Z',
  key: {
    product: 'test',
    domain: 'private-resources',
    scope: { kind: 'resource', tenantId: id('4'), groupId: id('5'), resourceId: id('6') },
    generation: 1,
  },
  keys: { signing: bytes(91), encryption: bytes(422) },
  proof: bytes(64),
} as const satisfies DeviceProof;
const signer: SigningPin = { deviceId: id('7'), signing: bytes(91, 7) };
const ids = (enrollment: DeviceProof, approver: SigningPin) => pairingCodeIdentifiers(crypto, enrollment, approver);
const withScope = (scope: Partial<Extract<DeviceProof['key']['scope'], { kind: 'resource' }>>): DeviceProof => ({
  ...proof,
  key: { ...proof.key, scope: { ...proof.key.scope, ...scope } },
});
const otherProof = { ...proof, keys: { ...proof.keys, encryption: bytes(422, 1) } };
const otherSignature = { ...proof, proof: bytes(64, 1) };
const otherSigner = { ...signer, signing: bytes(91, 8) };

function pairingWindow(): Window {
  return Object.assign(new EventTarget(), {
    crypto,
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    setTimeout,
    clearTimeout,
  }) as unknown as Window;
}

it('uses all eight digits and rejects samples at or above the unbiased boundary', () => {
  const next = vi
    .fn<() => number>()
    .mockReturnValueOnce(2 ** 32 - 1)
    .mockReturnValueOnce(4_200_000_000);

  next.mockReturnValueOnce(4_199_999_999);

  expect(generatePairingCode(next)).toBe('99999999');
  expect(next).toHaveBeenCalledTimes(3);
  expect(generatePairingCode(() => 100_000_000)).toBe('00000000');
  expect(generatePairingCode(() => 7)).toBe('00000007');
});

it.each([
  { ...proof, ownerId: id('8') },
  { ...proof, key: { ...proof.key, product: 'other' } },
  { ...proof, key: { ...proof.key, domain: 'other' } },
  { ...proof, key: { ...proof.key, scope: { kind: 'tenant' as const, tenantId: proof.key.scope.tenantId } } },
  withScope({ tenantId: id('8') }),
  withScope({ groupId: id('8') }),
  withScope({ resourceId: id('8') }),
  { ...proof, key: { ...proof.key, generation: 2 } },
  { ...proof, requestId: id('8') },
] satisfies DeviceProof[])('binds both identifiers to the shared enrollment context (%#)', async (changed) => {
  const before = await ids(proof, signer);
  const after = await ids(changed, signer);

  expect(after.client).not.toBe(before.client);
  expect(after.server).not.toBe(before.server);
});

it('binds each identifier to its device and key material', async () => {
  const before = await ids(proof, signer);

  for (const changed of [
    { ...proof, deviceId: id('8') },
    { ...proof, challenge: bytes(32, 1) },
    { ...proof, expiresAt: '2030-01-02T00:00:00.000Z' },
    { ...proof, keys: { ...proof.keys, signing: bytes(91, 1) } },
    otherProof,
    otherSignature,
  ]) {
    const after = await ids(changed, signer);

    expect(after.client).not.toBe(before.client);
  }

  for (const changed of [{ ...signer, deviceId: id('8') }, otherSigner]) {
    const after = await ids(proof, changed);

    expect(after.server).not.toBe(before.server);
  }
});

it.each(['retired', 'expired'] as const)('ends the approver wait when an unconfirmed request is %s', async (end) => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] });
  const view = pairingWindow();
  const controller = new AbortController();
  const pendingProof = end === 'expired' ? { ...proof, expiresAt: new Date(Date.now() + 6_000).toISOString() } : proof;
  const retired = new HttpErrorResponse({ status: 404 });
  let unavailable = false;
  let markPublished!: () => void;
  const published = new Promise<void>((resolve) => {
    markPublished = resolve;
  });

  try {
    const recipient = await RecipientPairingCode.start(crypto, controller.signal);
    const relay: PairingCodeExchange = { r1: recipient.r1, a1: null, r2: null };
    const send = vi.fn(async (_proof: DeviceProof, _signal: AbortSignal, message?: PairingCodeMessage) => {
      if (unavailable) {
        throw retired;
      }

      if (message?.step === 'a1') {
        relay.a1 = message.a1;
        markPublished();
      }

      return relay;
    });
    const exchange = new ExamplePairingExchange(
      view,
      send,
      () => false,
      (error) => error === retired,
      vi.fn(),
    );
    const approval = exchange.authenticateRecipient(
      pendingProof,
      signer,
      new ApproverPairingCode(recipient.code),
      controller.signal,
    );
    const rejected = expect(approval).rejects.toMatchObject({ code: 'unavailable' });

    await published;

    await vi.advanceTimersByTimeAsync(5_000);

    expect(send).toHaveBeenCalledTimes(3);
    unavailable = end === 'retired';

    await vi.advanceTimersByTimeAsync(10_000);

    await rejected;

    await expect(
      exchange.authenticateRecipient(pendingProof, signer, new ApproverPairingCode(recipient.code), controller.signal),
    ).rejects.toMatchObject({ code: 'corrupt' });

    expect(send).toHaveBeenCalledTimes(4);
  } finally {
    controller.abort();
    vi.useRealTimers();
  }
});

it('authenticates both peers once and refuses to replay either finish message', async () => {
  const recipient = await RecipientPairingCode.start(crypto, new AbortController().signal);
  const approver = new ApproverPairingCode(recipient.code);
  const identifiers = await ids(proof, signer);
  const a1 = await approver.start(recipient.r1, signer, identifiers);

  await expect(approver.start(recipient.r1, signer, identifiers)).rejects.toThrow();

  const receivedIdentifiers = await ids(proof, a1.signer);
  const r2 = recipient.finish(a1, receivedIdentifiers);

  expect(pairingCodeExchangeSchema.safeParse({ r1: recipient.r1, a1, r2 }).success).toBe(true);
  expect(() => recipient.finish(a1, identifiers)).toThrow();
  expect(recipient.code).toBe('');
  expect(() => approver.finish(r2)).not.toThrow();
  expect(() => approver.finish(r2)).toThrow();
});

it.each([
  ['wrong code', proof, signer, true],
  ['substituted proof', otherProof, signer, false],
  ['substituted proof signature', otherSignature, signer, false],
  ['substituted signing pin', proof, otherSigner, false],
  ['another owner', { ...proof, ownerId: id('8') }, signer, false],
  ['another vault', withScope({ resourceId: id('8') }), signer, false],
  ['another generation', { ...proof, key: { ...proof.key, generation: 2 } }, signer, false],
  ['another request', { ...proof, requestId: id('8') }, signer, false],
] as const)('refuses %s and discards the recipient code', async (_label, review, receivedSigner, wrongCode) => {
  const recipient = await RecipientPairingCode.start(crypto, new AbortController().signal);
  const code = recipient.code;
  const approver = new ApproverPairingCode(wrongCode ? (code.startsWith('0') ? '1' : '0') + code.slice(1) : code);
  const approverIdentifiers = await ids(review, signer);
  const a1 = await approver.start(recipient.r1, signer, approverIdentifiers);
  const exchanged = { ...a1, signer: receivedSigner };
  const identifiers = await ids(proof, exchanged.signer);

  expect(() => recipient.finish(exchanged, identifiers)).toThrow();
  expect(recipient.code).toBe('');
  expect(() => recipient.finish(exchanged, identifiers)).toThrow();
  expect(() => approver.finish(bytes(64))).toThrow();
  expect(() => approver.finish(bytes(64))).toThrow();
});

it('resumes with the authenticated signer after a committed R2 loses its reply', async () => {
  const view = pairingWindow();
  const signal = new AbortController();
  const relay: PairingCodeExchange = { r1: null, a1: null, r2: null };
  const retired = new HttpErrorResponse({ status: 404 });
  const send = async (_proof: DeviceProof, _signal: AbortSignal, message?: PairingCodeMessage) => {
    if (message?.step === 'r1') {
      relay.r1 = message.r1;
    }

    if (message?.step === 'r2') {
      relay.r2 = message.r2;

      throw new Error('Synthetic lost response');
    }

    return relay;
  };
  const cancel = vi.fn();
  const recipient = new ExamplePairingExchange(
    view,
    send,
    () => false,
    () => false,
    cancel,
  );
  const checkpoint = vi.fn<(signer?: SigningPin) => void>();
  const identifiers = await ids(proof, signer);

  await recipient.startRecipient(proof, signal.signal);

  const approver = new ApproverPairingCode(recipient.code().replace(/ /g, ''));
  const answer = await approver.start(relay.r1!, signer, identifiers);

  relay.a1 = answer;
  const stop = recipient.watchRecipient(proof, signal.signal, checkpoint, async () => false, vi.fn());

  try {
    await vi.waitFor(() => expect(relay.r2).toBeTruthy());

    expect(recipient.code()).toBe('');
    expect(checkpoint).toHaveBeenCalledExactlyOnceWith(signer);
    expect(() => approver.finish(relay.r2!)).not.toThrow();
  } finally {
    stop();
    signal.abort();
    expect(cancel).not.toHaveBeenCalled();
  }

  const resumed = new ExamplePairingExchange(
    view,
    async () => {
      throw retired;
    },
    () => false,
    (error) => error === retired,
    cancel,
  );
  const approved = vi.fn();
  const controller = new AbortController();
  const approval = { epoch: 2 };

  resumed.resume(checkpoint.mock.calls[0][0], proof);

  const stopResumed = resumed.watchRecipient(proof, controller.signal, vi.fn(), async () => approval, approved);

  try {
    await vi.waitFor(() => expect(approved).toHaveBeenCalledExactlyOnceWith(true, approval));

    expect(resumed.authenticatedSigner).toEqual(signer);
  } finally {
    stopResumed();
    controller.abort();
    resumed.clearRecipient();
    expect(cancel).not.toHaveBeenCalled();
  }
});

it('asks the relay to retire the request when the recipient cannot confirm the code', async () => {
  const controller = new AbortController();
  const relay: PairingCodeExchange = { r1: null, a1: null, r2: null };
  const send = vi.fn(async (_proof: DeviceProof, _signal: AbortSignal, message?: PairingCodeMessage) => {
    if (message?.step === 'r1') {
      relay.r1 = message.r1;
    }

    return relay;
  });
  const cancel = vi.fn().mockRejectedValue(new Error('Synthetic network failure'));
  const recipient = new ExamplePairingExchange(
    pairingWindow(),
    send,
    () => false,
    () => false,
    cancel,
  );
  const checkpoint = vi.fn();

  await recipient.startRecipient(proof, controller.signal);

  const code = recipient.code().replaceAll(' ', '');
  const wrong = String((Number(code[0]) + 1) % 10) + code.slice(1);
  const approver = new ApproverPairingCode(wrong);
  const identifiers = await ids(proof, signer);

  const answer = await approver.start(relay.r1!, signer, identifiers);

  relay.a1 = answer;
  const stop = recipient.watchRecipient(proof, controller.signal, checkpoint, async () => false, vi.fn());

  try {
    await vi.waitFor(() => expect(recipient.recipientEnd()).toBe('unconfirmed'));

    expect(recipient.code()).toBe('');
    expect(checkpoint).not.toHaveBeenCalled();
    expect(send.mock.calls.some(([, , message]) => message?.step === 'r2')).toBe(false);
    recipient.clearRecipient();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(proof);
  } finally {
    stop();
    controller.abort();
    approver.clear();
  }
});

it.each(['cancel', 'discard'] as const)('retires a live request once on %s', async (action) => {
  const controller = new AbortController();
  const cancel = vi.fn().mockResolvedValue(undefined);
  const exchange = new ExamplePairingExchange(
    pairingWindow(),
    vi.fn(),
    () => false,
    () => false,
    cancel,
  );

  await exchange.startRecipient(proof, controller.signal);

  if (action === 'cancel') {
    exchange.endRecipient('cancelled');
    expect(exchange.recipientEnd()).toBe('cancelled');
  } else {
    controller.abort();
    expect(exchange.recipientEnd()).toBe('unconfirmed');
  }

  expect(exchange.code()).toBe('');
  exchange.clearRecipient();
  expect(cancel).toHaveBeenCalledExactlyOnceWith(proof);
});

it('keeps an expired draft ended when the relay already retired it', () => {
  const cancel = vi.fn().mockRejectedValue(new HttpErrorResponse({ status: 404 }));
  const exchange = new ExamplePairingExchange(
    pairingWindow(),
    vi.fn(),
    () => false,
    () => false,
    cancel,
  );

  const expired = { ...proof, expiresAt: '2000-01-01T00:00:00.000Z' };

  exchange.resume(undefined, expired);

  expect(exchange.recipientEnd()).toBe('expired');
  expect(cancel).toHaveBeenCalledExactlyOnceWith(expired);
});
