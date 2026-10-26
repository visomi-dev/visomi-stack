import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

import { cbor } from './cbor';

export function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const key = cbor(
    new Map<unknown, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ]),
  );
  const id = randomBytes(32);
  let counter = 0;
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest();
  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    id: id.toString('base64url'),
    register(challenge: string, origin: string, rpId: string, verified = true): RegistrationResponseJSON {
      const count = Buffer.alloc(4);
      const length = Buffer.alloc(2);

      length.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        hash(rpId),
        Buffer.from([verified ? 0x45 : 0x41]),
        count,
        Buffer.alloc(16),
        length,
        id,
        key,
      ]);
      const attestationObject = cbor(
        new Map<unknown, unknown>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );

      return {
        id: id.toString('base64url'),
        rawId: id.toString('base64url'),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          attestationObject: attestationObject.toString('base64url'),
          clientDataJSON: clientData('webauthn.create', challenge, origin).toString('base64url'),
          transports: ['internal'],
        },
      };
    },
    authenticate(
      challenge: string,
      origin: string,
      rpId: string,
      userId?: string,
      verified = true,
      assertion: { counter?: number; backupEligible?: boolean; backupState?: boolean } = {},
    ): AuthenticationResponseJSON {
      const count = Buffer.alloc(4);

      counter = assertion.counter ?? counter + 1;
      count.writeUInt32BE(counter);
      const flags =
        (verified ? 0x05 : 0x01) | (assertion.backupEligible ? 0x08 : 0) | (assertion.backupState ? 0x10 : 0);
      const authData = Buffer.concat([hash(rpId), Buffer.from([flags]), count]);
      const client = clientData('webauthn.get', challenge, origin);
      const signature = sign('sha256', Buffer.concat([authData, hash(client)]), privateKey);

      return {
        id: id.toString('base64url'),
        rawId: id.toString('base64url'),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          authenticatorData: authData.toString('base64url'),
          clientDataJSON: client.toString('base64url'),
          signature: signature.toString('base64url'),
          userHandle: userId ? Buffer.from(userId).toString('base64url') : undefined,
        },
      };
    },
  };
}
