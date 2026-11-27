import { z } from 'zod';
import {
  approvedDeliverySchema,
  deliveryBindingSchema,
  deviceChallengeSchema,
  keyDomainId,
  signingPinSchema,
  VaultError,
  type DeviceProof,
  type KeyDomain,
  type WrappingContext,
} from '@visomi-stack/shared-db';
import {
  WebCryptoDevices,
  decodeBytes,
  encodeBytes,
  provisionDeviceIdentity,
  restoreDeviceIdentity,
  type DeviceCustody,
} from '@visomi-stack/web-frontend-db';

import type { DatabaseHttp } from '../shared/db/http';
import type { VaultSession } from '../shared/vault/vault-session';

const recoveryFile = z.strictObject({
  format: z.literal('visomi.vault-recovery.v1'),
  origin: z.string(),
  recipient: deliveryBindingSchema,
  signer: signingPinSchema,
  material: z.string().max(11000),
  length: z.number().int().positive().max(8192),
});

export async function proofRecipient(devices: WebCryptoDevices, proof: DeviceProof) {
  const fingerprint = await devices.fingerprint(proof);

  return {
    key: proof.key,
    ownerId: proof.ownerId,
    deviceId: proof.deviceId,
    requestId: proof.requestId,
    challenge: proof.challenge,
    fingerprint,
    encryption: proof.keys.encryption,
  };
}

export async function approvalAction(crypto: Crypto, key: KeyDomain, deviceId: string, epoch: number, body: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));

  return {
    key,
    deviceId,
    epoch,
    action: 'approve' as const,
    operationId: crypto.randomUUID(),
    bodyHash: encodeBytes(new Uint8Array(digest)),
  };
}

/** Only the public proof, encrypted delivery and signed approval may cross the network. */
export async function prepareRecovery(
  api: DatabaseHttp,
  path: string,
  vault: VaultSession,
  binding: WrappingContext,
  custody: DeviceCustody,
  epoch: number,
  signal: AbortSignal,
  initialKey?: Uint8Array,
  pin?: Uint8Array,
) {
  const devices = new WebCryptoDevices(crypto);
  let material = '';
  let length = 0;
  const identity = await provisionDeviceIdentity(crypto, async (bytes) => {
    material = encodeBytes(bytes);
    length = bytes.length;
  });
  const keys = await devices.publicKeys(identity);
  const deviceId = crypto.randomUUID();
  const raw = await api.vault(path + '/devices/request', { deviceId, keys }, signal);
  const challenge = deviceChallengeSchema.parse(raw);

  if (
    challenge.ownerId !== binding.ownerId ||
    challenge.deviceId !== deviceId ||
    keyDomainId(binding.ownerId, challenge.key) !== keyDomainId(binding.ownerId, binding.key)
  ) {
    throw new VaultError('corrupt');
  }

  const proof = await devices.prove(identity, challenge);
  const recipient = await proofRecipient(devices, proof);
  const delivery = await (initialKey ? devices.seal(initialKey, recipient) : vault.deliver(binding, recipient, pin));
  const body = { proof, delivery };
  const action = await approvalAction(crypto, binding.key, binding.deviceId, epoch, body);
  const authorization = await custody.sign(action);
  const creator = await custody.publicKeys();
  const signer = { deviceId: binding.deviceId, signing: creator.signing };

  signal.throwIfAborted();
  const file = new Blob(
    [
      JSON.stringify(
        recoveryFile.parse({
          format: 'visomi.vault-recovery.v1',
          origin: binding.origin,
          signer,
          recipient,
          material,
          length,
        }),
      ),
    ],
    { type: 'application/json' },
  );

  return { file, approval: { ...body, authorization } };
}

/** The saved file pins both the recipient challenge and the original approver independently of the cloud roster. */
export async function readRecovery(file: File, key: KeyDomain, ownerId: string, origin: string) {
  if (file.size > 20000) {
    throw new VaultError('recovery-required');
  }

  const content = await file.text();
  let data: unknown;

  try {
    data = JSON.parse(content);
  } catch {
    throw new VaultError('recovery-required');
  }
  const parsed = recoveryFile.safeParse(data);

  if (
    !parsed.success ||
    parsed.data.origin !== origin ||
    parsed.data.recipient.ownerId !== ownerId ||
    keyDomainId(ownerId, parsed.data.recipient.key) !== keyDomainId(ownerId, key)
  ) {
    throw new VaultError('recovery-required');
  }

  const { material, length, recipient, signer } = parsed.data;
  const bytes = decodeBytes(material, length);

  try {
    const identity = await restoreDeviceIdentity(crypto, bytes);

    return { identity, recipient, signer };
  } finally {
    bytes.fill(0);
  }
}

export async function recoverApproval(
  api: DatabaseHttp,
  path: string,
  recovery: Awaited<ReturnType<typeof readRecovery>>,
  proof: DeviceProof,
  epoch: number,
  enrolled: boolean,
  signal: AbortSignal,
) {
  const devices = new WebCryptoDevices(crypto);
  const publicKeys = await devices.publicKeys(recovery.identity);
  const signer = { deviceId: recovery.recipient.deviceId, signing: publicKeys.signing };

  // A lost approval response may leave a complete delivery. Installation still checks its signature against the file.
  if (enrolled) {
    return signer;
  }

  const raw = await api.vault(path + '/devices/' + recovery.recipient.deviceId + '/delivery', undefined, signal);
  const envelope = approvedDeliverySchema.parse(raw);
  const key = await devices.accept(
    recovery.identity.encryption.privateKey,
    recovery.recipient,
    envelope,
    recovery.signer,
  );

  try {
    const recipient = await proofRecipient(devices, proof);
    const delivery = await devices.seal(key, recipient);
    const body = { proof, delivery };
    const action = await approvalAction(crypto, proof.key, recovery.recipient.deviceId, epoch, body);
    const authorization = await devices.signAction(recovery.identity, action);

    await api.vault(path + '/devices/approve', { ...body, authorization }, signal);

    return signer;
  } finally {
    key.fill(0);
  }
}
