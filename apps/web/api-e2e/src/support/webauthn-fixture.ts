import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

type CoseKey = { x: Buffer; y: Buffer };

export type RegistrationFixture = {
  credentialId: string;
  privateKey: KeyObject;
  response: JsonRecord;
};

export type JsonRecord = { [key: string]: unknown };

function encodeLength(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);

  return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
}

function encodeCbor(value: unknown): Buffer {
  if (value instanceof Buffer) return Buffer.concat([encodeLength(2, value.length), value]);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value);

    return Buffer.concat([encodeLength(3, bytes.length), bytes]);
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= 0) return encodeLength(0, value);

    return encodeLength(1, -1 - value);
  }
  if (Array.isArray(value)) return Buffer.concat([encodeLength(4, value.length), ...value.map(encodeCbor)]);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    return Buffer.concat([
      encodeLength(5, entries.length),
      ...entries.flatMap(([key, entryValue]) => [
        encodeCbor(Number.isNaN(Number(key)) ? key : Number(key)),
        encodeCbor(entryValue),
      ]),
    ]);
  }
  throw new Error(`Unsupported CBOR fixture value: ${String(value)}`);
}

function publicKeyCoordinates(publicKey: KeyObject): CoseKey {
  const der = publicKey.export({ type: 'spki', format: 'der' });

  return { x: der.subarray(-64, -32), y: der.subarray(-32) };
}

function cosePublicKey(publicKey: KeyObject): Buffer {
  const { x, y } = publicKeyCoordinates(publicKey);

  return encodeCbor({ 1: 2, 3: -7, '-1': 1, '-2': x, '-3': y });
}

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin }));
}

function rpHash(rpId: string): Buffer {
  return createHash('sha256').update(rpId).digest();
}

export function createRegistrationFixture(options: JsonRecord, origin: string, rpId: string): RegistrationFixture {
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKey = keyPair.privateKey as KeyObject;
  const publicKey = keyPair.publicKey as KeyObject;
  const credentialId = Buffer.from(cryptoRandomId()).toString('base64url');
  const clientDataJSON = clientData('webauthn.create', String(options.challenge), origin);
  const authenticatorData = Buffer.concat([
    rpHash(rpId),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    Buffer.from([
      Buffer.from(credentialId, 'base64url').length >> 8,
      Buffer.from(credentialId, 'base64url').length & 0xff,
    ]),
    Buffer.from(credentialId, 'base64url'),
    cosePublicKey(publicKey),
  ]);
  const attestationObject = encodeCbor({ fmt: 'none', attStmt: {}, authData: authenticatorData });

  return {
    credentialId,
    privateKey,
    response: {
      id: credentialId,
      rawId: credentialId,
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        attestationObject: attestationObject.toString('base64url'),
        transports: ['internal'],
      },
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    },
  };
}

export function createAuthenticationResponse(
  options: JsonRecord,
  credential: RegistrationFixture,
  origin: string,
  rpId: string,
  originOverride?: string,
  rpIdOverride?: string,
  counter = 1,
): JsonRecord {
  const clientDataJSON = clientData('webauthn.get', String(options.challenge), originOverride ?? origin);
  const authenticatorData = Buffer.concat([
    rpHash(rpIdOverride ?? rpId),
    Buffer.from([0x05]),
    Buffer.from([(counter >>> 24) & 0xff, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff]),
  ]);
  const signature = sign(
    'sha256',
    Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]),
    credential.privateKey,
  );

  return {
    id: credential.credentialId,
    rawId: credential.credentialId,
    response: {
      clientDataJSON: clientDataJSON.toString('base64url'),
      authenticatorData: authenticatorData.toString('base64url'),
      signature: signature.toString('base64url'),
      userHandle: null,
    },
    type: 'public-key',
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
  };
}

function cryptoRandomId(): Uint8Array {
  return randomBytes(16);
}
