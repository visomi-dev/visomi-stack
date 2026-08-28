import { generateKeyPairSync } from 'node:crypto';

import { createLocalAgentChallenge, signLocalAgentHandshake, verifyLocalAgentHandshake } from './local-agent-handshake';

describe('local-agent handshake', () => {
  it('binds the response to origin, session, and a fresh nonce', () => {
    const keys = generateKeyPairSync('ed25519');
    const challenge = createLocalAgentChallenge('https://app.example.test', 'session-1');
    const response = signLocalAgentHandshake(challenge, 'device-1', keys.privateKey);

    expect(verifyLocalAgentHandshake(challenge, response, keys.publicKey)).toBe(true);
    expect(verifyLocalAgentHandshake({ ...challenge, origin: 'https://evil.test' }, response, keys.publicKey)).toBe(
      false,
    );
    expect(verifyLocalAgentHandshake({ ...challenge, nonce: 'replayed' }, response, keys.publicKey)).toBe(false);
  });

  it('rejects forged or cross-session responses', () => {
    const keys = generateKeyPairSync('ed25519');
    const attacker = generateKeyPairSync('ed25519');
    const challenge = createLocalAgentChallenge('https://app.example.test', 'session-1');
    const forged = signLocalAgentHandshake(challenge, 'device-evil', attacker.privateKey);

    expect(verifyLocalAgentHandshake(challenge, forged, keys.publicKey)).toBe(false);
    expect(verifyLocalAgentHandshake({ ...challenge, sessionId: 'session-2' }, forged, attacker.publicKey)).toBe(false);
  });
});
