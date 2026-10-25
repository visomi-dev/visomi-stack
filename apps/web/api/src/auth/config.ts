export type AuthConfig = ReturnType<typeof authConfig>;

export function authConfig(input: { origin: string; rpId: string; secret: string }) {
  let origin: URL;

  try {
    origin = new URL(input.origin);
  } catch {
    throw new Error('auth_configuration_invalid');
  }

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);

  if (
    origin.origin !== input.origin ||
    origin.username ||
    origin.password ||
    (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
    !input.rpId ||
    (!local && !input.rpId.includes('.')) ||
    !(origin.hostname === input.rpId || origin.hostname.endsWith(`.${input.rpId}`)) ||
    typeof input.secret !== 'string' ||
    Buffer.byteLength(input.secret) < 32
  ) {
    throw new Error('auth_configuration_invalid');
  }

  return Object.freeze({
    ...input,
    secure: origin.protocol === 'https:',
    cookieName: origin.protocol === 'https:' ? '__Host-visomi.sid' : 'visomi.sid',
    sessionMaxAge: 8 * 60 * 60_000,
    challengeMaxAge: 3 * 60_000,
    freshMaxAge: 5 * 60_000,
  });
}
