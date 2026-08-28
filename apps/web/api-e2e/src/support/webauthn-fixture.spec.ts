import { createHash, verify } from 'node:crypto';

import { createAuthenticationResponse, createRegistrationFixture } from './webauthn-fixture';

type JsonRecord = { [key: string]: unknown };

function decode(value: unknown): Buffer {
  if (typeof value !== 'string') throw new Error('Expected a base64url WebAuthn value.');

  return Buffer.from(value, 'base64url');
}

describe('WebAuthn HTTP fixture', () => {
  const options = { challenge: 'application-returned-challenge' };
  const origin = 'http://localhost:8080';
  const rpId = 'localhost';

  it('creates a registration response with an attestation object and ephemeral credential key', () => {
    const fixture = createRegistrationFixture(options, origin, rpId);
    const registrationResponse = fixture.response.response as JsonRecord;
    const clientData = JSON.parse(decode(registrationResponse.clientDataJSON).toString('utf8')) as {
      challenge?: string;
      origin?: string;
      type?: string;
    };

    expect(clientData).toEqual({ challenge: options.challenge, origin, type: 'webauthn.create' });
    expect(decode(registrationResponse.attestationObject).length).toBeGreaterThan(0);
    expect(fixture.credentialId).toBe(fixture.response.id);
  });

  it('creates an assertion whose signature is verifiable by the generated credential key', () => {
    const fixture = createRegistrationFixture(options, origin, rpId);
    const response = createAuthenticationResponse(options, fixture, origin, rpId);
    const assertionResponse = response.response as JsonRecord;
    const clientDataJSON = decode(assertionResponse.clientDataJSON);
    const authenticatorData = decode(assertionResponse.authenticatorData);
    const signature = decode(assertionResponse.signature);

    expect(
      verify(
        'sha256',
        Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]),
        fixture.privateKey,
        signature,
      ),
    ).toBe(true);
  });
});
