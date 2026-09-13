import { createHmac } from 'node:crypto';

import axios, { type AxiosResponse } from 'axios';

const origin = 'http://localhost:8080';
const csrfConfig = { headers: { Origin: origin } };

const toCookieHeader = (setCookie: string[] | undefined) =>
  setCookie?.map((cookie) => cookie.split(';', 1)[0]).join('; ') ?? '';

const cookieConfig = (cookie: string) => ({ headers: { ...csrfConfig.headers, Cookie: cookie } });

function generateTotp(secret: string, timestamp = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = secret.replace(/=+$/u, '').toUpperCase();
  let bits = '';

  for (const character of normalized) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));

  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const counter = Math.floor(timestamp / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', bytes).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;

  return String(value % 1_000_000).padStart(6, '0');
}

async function createPasswordAccount(suffix: string): Promise<{ email: string; password: string }> {
  const email = `auth-rework-${suffix}-${Date.now()}@visomi-stack.dev`;
  const password = 'a sufficiently long password';
  const session = await axios.post('/test/auth/session', { email, mode: 'restricted' });
  const sessionCookie = toCookieHeader(session.headers['set-cookie']);

  await axios.post('/auth/password/set', { password }, cookieConfig(sessionCookie));

  return { email, password };
}

async function startPasswordSignIn(email: string, password: string): Promise<AxiosResponse> {
  return axios.post('/auth/password/sign-in', { email, password }, csrfConfig);
}

describe('auth rework API contracts', () => {
  beforeEach(async () => {
    await axios.delete('/test/mailbox');
  });

  it('supports password plus a server-selected email verification step', async () => {
    const account = await createPasswordAccount('email');
    const pending = await startPasswordSignIn(account.email, account.password);

    expect(pending.status).toBe(202);
    expect(pending.data.data.requiredFactor).toBe('email');
    expect(pending.data.data.maskedEmail).toBe(`${account.email[0]}***@visomi-stack.dev`);

    const pendingCookie = toCookieHeader(pending.headers['set-cookie']);
    const session = await axios.get('/auth/session', { headers: { Cookie: pendingCookie } });

    expect(session.data.data).toEqual(expect.objectContaining({ authenticated: false, kind: 'anonymous' }));
  }, 15_000);

  it('selects TOTP after password proof and refuses email downgrade', async () => {
    const account = await createPasswordAccount('totp');
    const session = await axios.post('/test/auth/session', { email: account.email });
    const sessionCookie = toCookieHeader(session.headers['set-cookie']);
    const setup = await axios.post('/auth/totp/setup', {}, cookieConfig(sessionCookie));

    await axios.post(
      '/auth/totp/confirm',
      { enrollmentId: setup.data.data.enrollmentId, code: generateTotp(setup.data.data.secret) },
      cookieConfig(sessionCookie),
    );

    const pending = await startPasswordSignIn(account.email, account.password);
    const pendingCookie = toCookieHeader(pending.headers['set-cookie']);

    expect(pending.data.data.requiredFactor).toBe('totp');
    await expect(
      axios.post('/auth/password/resend', { flowId: pending.data.data.flowId }, cookieConfig(pendingCookie)),
    ).rejects.toMatchObject({ response: { status: 409, data: { code: 'password_factor_invalid' } } });
    const verified = await axios.post(
      '/auth/password/verify',
      { flowId: pending.data.data.flowId, code: generateTotp(setup.data.data.secret), kind: 'totp' },
      cookieConfig(pendingCookie),
    );

    expect(verified.status).toBe(200);
    expect(verified.data.data.user.secondFactor).toBe('totp');
  }, 15_000);

  it('reports Google as unavailable without configuration instead of hiding other methods', async () => {
    const providers = await axios.get('/auth/identity/providers');

    expect(providers.data.data.google).toEqual({ enabled: false, clientId: null });
    expect(providers.data.data.password.enabled).toBe(true);
  });
});
