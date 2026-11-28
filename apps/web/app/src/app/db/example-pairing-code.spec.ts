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
  const view = Object.assign(new EventTarget(), {
    crypto,
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    setTimeout,
    clearTimeout,
  }) as unknown as Window;
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
  const recipient = new ExamplePairingExchange(
    view,
    send,
    () => false,
    () => false,
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
  }

  const resumed = new ExamplePairingExchange(
    view,
    async () => {
      throw retired;
    },
    () => false,
    (error) => error === retired,
  );
  const approved = vi.fn();
  const controller = new AbortController();
  const approval = { epoch: 2 };

  resumed.resume(checkpoint.mock.calls[0][0]);

  const stopResumed = resumed.watchRecipient(proof, controller.signal, vi.fn(), async () => approval, approved);

  try {
    await vi.waitFor(() => expect(approved).toHaveBeenCalledExactlyOnceWith(true, approval));

    expect(resumed.authenticatedSigner).toEqual(signer);
  } finally {
    stopResumed();
    controller.abort();
  }
});
