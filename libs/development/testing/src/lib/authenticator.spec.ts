import { randomUUID } from 'node:crypto';

import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { describe, expect, it } from 'vitest';

import { authenticator } from './authenticator';

const origin = 'http://localhost';
const rpId = 'localhost';
const challenge = 'synthetic_cryptographic_challenge';

async function registration(device: ReturnType<typeof authenticator>) {
  const result = await verifyRegistrationResponse({
    response: device.register(challenge, origin, rpId),
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    requireUserVerification: true,
  });

  if (!result.verified) {
    throw new Error('synthetic_registration_failed');
  }

  return result.registrationInfo.credential;
}

describe('synthetic ES256 authenticator', () => {
  it('creates independent credentials and cryptographically valid registration and login responses', async () => {
    const first = authenticator();
    const second = authenticator();
    const credential = await registration(first);
    const userId = randomUUID();
    const response = first.authenticate(challenge, origin, rpId, userId);
    const result = await verifyAuthenticationResponse({
      response,
      credential,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: true,
    });

    expect(first.id).not.toBe(second.id);
    expect(credential.id).toBe(first.id);
    expect(response.response.userHandle).toBe(Buffer.from(userId).toString('base64url'));
    expect(result.verified).toBe(true);
    expect(result.authenticationInfo.newCounter).toBe(1);
    const next = first.authenticate(challenge, origin, rpId);
    const nextResult = await verifyAuthenticationResponse({
      response: next,
      credential: { ...credential, counter: 1 },
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: true,
    });

    expect(next.response.userHandle).toBeUndefined();
    expect(nextResult.authenticationInfo.newCounter).toBe(2);
  });

  it('supports explicit counter races and independent verification and backup flags', async () => {
    const device = authenticator();
    const credential = await registration(device);
    const response = device.authenticate(challenge, origin, rpId, undefined, false, {
      counter: 7,
      backupEligible: true,
      backupState: true,
    });
    const data = Buffer.from(response.response.authenticatorData, 'base64url');
    const result = await verifyAuthenticationResponse({
      response,
      credential,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: false,
    });

    expect(data[32]).toBe(0x19);
    expect(data.readUInt32BE(33)).toBe(7);
    expect(result.authenticationInfo).toMatchObject({
      newCounter: 7,
      userVerified: false,
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    });

    await expect(
      verifyRegistrationResponse({
        response: device.register(challenge, origin, rpId, false),
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      }),
    ).rejects.toThrow();
  });
});
