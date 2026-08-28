import { createHash, randomBytes, sign, verify, type KeyObject } from 'node:crypto';

export type LocalAgentHandshakeChallenge = Readonly<{
  nonce: string;
  origin: string;
  sessionId: string;
  issuedAt: string;
}>;

export type LocalAgentHandshakeResponse = Readonly<{
  nonce: string;
  origin: string;
  sessionId: string;
  deviceId: string;
  signature: string;
}>;

function payload(value: Pick<LocalAgentHandshakeResponse, 'nonce' | 'origin' | 'sessionId' | 'deviceId'>): Buffer {
  return Buffer.from(
    JSON.stringify({ deviceId: value.deviceId, nonce: value.nonce, origin: value.origin, sessionId: value.sessionId }),
    'utf8',
  );
}

export function createLocalAgentChallenge(origin: string, sessionId: string): LocalAgentHandshakeChallenge {
  return { nonce: randomBytes(32).toString('base64url'), origin, sessionId, issuedAt: new Date().toISOString() };
}

export function signLocalAgentHandshake(
  challenge: LocalAgentHandshakeChallenge,
  deviceId: string,
  privateKey: KeyObject,
): LocalAgentHandshakeResponse {
  const unsigned = { deviceId, nonce: challenge.nonce, origin: challenge.origin, sessionId: challenge.sessionId };

  return { ...unsigned, signature: sign(null, payload(unsigned), privateKey).toString('base64url') };
}

export function verifyLocalAgentHandshake(
  challenge: LocalAgentHandshakeChallenge,
  response: LocalAgentHandshakeResponse,
  publicKey: KeyObject,
): boolean {
  if (Number.isNaN(Date.parse(challenge.issuedAt)) || Date.now() - Date.parse(challenge.issuedAt) > 30_000)
    return false;
  if (
    response.nonce !== challenge.nonce ||
    response.origin !== challenge.origin ||
    response.sessionId !== challenge.sessionId ||
    !response.deviceId ||
    !response.signature
  ) {
    return false;
  }

  return verify(null, payload(response), publicKey, Buffer.from(response.signature, 'base64url'));
}

export function handshakeReplayKey(response: LocalAgentHandshakeResponse): string {
  return createHash('sha256').update(`${response.sessionId}:${response.nonce}`).digest('hex');
}
