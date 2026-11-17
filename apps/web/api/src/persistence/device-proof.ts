import { createHash, createPublicKey, verify } from 'node:crypto';

import {
  deviceActionMessage,
  deviceProofMessage,
  type DeviceAction,
  type DeviceProof,
} from '@visomi-stack/shared-persistence';
import { HttpError } from '@visomi-stack/web-backend-shared';

export const publicHash = (value: string) => createHash('sha256').update(value).digest('base64url');

export function verifyDeviceProof(proof: DeviceProof): void {
  const key = publicKey(proof.keys.signing, 'signing');

  publicKey(proof.keys.encryption, 'encryption');

  if (
    !verify(
      'sha256',
      Buffer.from(deviceProofMessage(proof)),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(proof.proof, 'base64url'),
    )
  ) {
    throw new HttpError(400, 'device_proof_invalid');
  }
}

export function verifyDeviceAction(signing: string, action: DeviceAction, body: unknown): void {
  const key = publicKey(signing, 'signing');

  if (
    action.bodyHash !== publicHash(JSON.stringify(body)) ||
    !verify(
      'sha256',
      Buffer.from(deviceActionMessage(action)),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(action.signature, 'base64url'),
    )
  ) {
    throw new HttpError(400, 'device_proof_invalid');
  }
}

function publicKey(encoded: string, usage: 'signing' | 'encryption') {
  try {
    const key = createPublicKey({ key: Buffer.from(encoded, 'base64url'), format: 'der', type: 'spki' });
    const details = key.asymmetricKeyDetails;

    if (
      usage === 'signing'
        ? key.asymmetricKeyType !== 'ec' || details?.namedCurve !== 'prime256v1'
        : key.asymmetricKeyType !== 'rsa' || details?.modulusLength !== 3072 || details.publicExponent !== BigInt(65537)
    ) {
      throw new Error();
    }

    return key;
  } catch {
    throw new HttpError(400, 'device_proof_invalid');
  }
}
