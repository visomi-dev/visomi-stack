import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';

import { authSchema } from '@visomi-stack/backend-shared';
import { eq } from 'drizzle-orm';
import { OAuth2Client } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticationFixture } from './support/auth';

const f = authenticationFixture();
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const cert = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

beforeEach(() => {
  vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({
    certs: { synthetic: cert },
    format: 'PEM',
  } as never);
});
afterEach(() => vi.restoreAllMocks());
function signed(nonce: string, email: string, sub: string, changes = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'synthetic' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: f.runtime.config.googleClientId,
      sub,
      email,
      email_verified: true,
      nonce,
      iat: now - 10,
      exp: now + 600,
      ...changes,
    }),
  ).toString('base64url');
  const signer = createSign('RSA-SHA256');

  signer.update(`${header}.${claims}`);

  return `${header}.${claims}.${signer.sign(pair.privateKey).toString('base64url')}`;
}
async function login(email: string, sub: string, changes = {}) {
  const browser = await f.client();
  const start = await browser.call('POST', '/google/start', {});
  const token = signed(start.data.nonce, email, sub, changes);
  const result = await browser.call('POST', '/google/complete', { flowId: start.data.flowId, idToken: token });

  return { browser, result, start, token };
}

describe('Google identity verification and automatic account unification', () => {
  it('unifies by verified email, retaining identity, password and existing methods', async () => {
    const email = `${randomUUID()}@gmail.com`;
    const { userId } = await f.signup(email);
    const before = await f.db.select().from(authSchema.users).where(eq(authSchema.users.id, userId));
    const { result } = await login(email, randomUUID());

    expect(result.status).toBe(200);
    expect(result.data.user.id).toBe(userId);
    const after = await f.db.select().from(authSchema.users).where(eq(authSchema.users.email, email));

    expect(after).toHaveLength(1);
    expect(after[0].passwordHash).toBe(before[0].passwordHash);
  });

  it('keeps linked subject authority when Google changes the email', async () => {
    const subject = randomUUID();
    const first = await login(`${randomUUID()}@gmail.com`, subject);
    const next = await login(`${randomUUID()}@gmail.com`, subject);

    expect(next.result.status).toBe(200);
    expect(next.result.data.user.id).toBe(first.result.data.user.id);
    expect(next.result.data.user.email).toBe(first.result.data.user.email);
  });

  it('revokes credentials and sessions planted before email ownership was proven', async () => {
    const email = `${randomUUID()}@gmail.com`;
    const attacker = await f.client();
    const pending = await attacker.call('POST', '/password/sign-up', { email, password: 'Synthetic planted password' });
    const owner = await login(email, randomUUID());

    expect(owner.result.status).toBe(200);
    expect(owner.result.data.user.id).toBe(pending.data.user.id);
    const [user] = await f.db.select().from(authSchema.users).where(eq(authSchema.users.id, owner.result.data.user.id));

    expect(user.passwordHash).toBeNull();
    const result1 = await attacker.call('GET', '/session');

    expect(result1.data.authenticated).toBe(false);
  });

  it('requires SMTP verification for external email and burns tokens and verification codes', async () => {
    const email = `${randomUUID()}@example.test`;
    const { browser, result, start, token } = await login(email, randomUUID());

    expect(result.status).toBe(202);
    const result2 = await browser.call('GET', '/session');

    expect(result2.data.authenticated).toBe(false);
    const result3 = await browser.call('POST', '/google/complete', { flowId: start.data.flowId, idToken: token });

    expect(result3.status).toBe(400);
    const complete = await browser.call('POST', '/google/email/verify', {
      flowId: result.data.flowId,
      code: f.lastCode(email),
    });

    expect(complete.status).toBe(200);
    expect(complete.data.access).toBe('full');
    const result4 = await browser.call('POST', '/google/email/verify', {
      flowId: result.data.flowId,
      code: f.lastCode(email),
    });

    expect(result4.status).toBe(400);
  });

  it.each([
    { aud: 'another-client' },
    { iss: 'https://attacker.example.test' },
    { exp: 1 },
    { nonce: 'another-nonce' },
    { email_verified: false },
    { sub: '' },
  ])('rejects signed tokens with invalid claims %j', async (claims) => {
    const { result } = await login(`${randomUUID()}@gmail.com`, randomUUID(), claims);

    expect(result.status).toBe(401);
    expect(result.data).toEqual({ error: 'google_token_invalid' });
  });

  it('serializes concurrent unification without creating duplicate identities', async () => {
    const email = `${randomUUID()}@gmail.com`;
    const subject = randomUUID();
    const results = await Promise.all([login(email, subject), login(email, subject)]);

    expect(results.every((result) => result.result.status === 200)).toBe(true);
    expect(results[0].result.data.user.id).toBe(results[1].result.data.user.id);
    const identities = await f.db
      .select()
      .from(authSchema.federatedIdentities)
      .where(eq(authSchema.federatedIdentities.subject, subject));

    expect(identities).toHaveLength(1);
  });
});

it('links, reauthenticates, unlinks and explicitly relinks Google without transferring another identity', async () => {
  const owner = await f.signup();
  const subject = randomUUID();
  const email = `${randomUUID()}@gmail.com`;
  const link = await owner.browser.call('POST', '/google/start', { intent: 'link' });
  const linked = await owner.browser.call('POST', '/google/complete', {
    flowId: link.data.flowId,
    idToken: signed(link.data.nonce, email, subject),
  });

  expect(linked.status).toBe(200);
  const methods = await owner.browser.call('GET', '/methods');
  const identityId = methods.data.google[0].id;
  const reauth = await owner.browser.call('POST', '/google/start', { intent: 'reauth' });
  const refreshed = await owner.browser.call('POST', '/google/complete', {
    flowId: reauth.data.flowId,
    idToken: signed(reauth.data.nonce, email, subject),
  });

  expect(refreshed.status).toBe(200);
  const foreign = await f.signup();
  const attempt = await foreign.browser.call('POST', '/google/start', { intent: 'link' });
  const result1 = await foreign.browser.call('POST', '/google/complete', {
    flowId: attempt.data.flowId,
    idToken: signed(attempt.data.nonce, email, subject),
  });

  expect(result1.status).toBe(409);
  const result2 = await foreign.browser.call('DELETE', `/google/${identityId}`);

  expect(result2.status).toBe(404);
  const removed = await owner.browser.call('DELETE', `/google/${identityId}`);

  expect(removed.status).toBe(204);
  const revoked = await login(email, subject);

  expect(revoked.result.status).toBe(409);
  const newLogin = await owner.browser.call('GET', '/session');

  expect(newLogin.data.authenticated).toBe(false);
  const passwordLogin = await owner.browser.call('POST', '/password/sign-in', {
    email: owner.email,
    password: 'Synthetic password 42!',
  });

  await owner.browser.call('POST', '/password/verify', {
    flowId: passwordLogin.data.flowId,
    factor: { kind: 'email', code: f.lastCode(owner.email) },
  });
  const relink = await owner.browser.call('POST', '/google/start', { intent: 'link' });
  const result3 = await owner.browser.call('POST', '/google/complete', {
    flowId: relink.data.flowId,
    idToken: signed(relink.data.nonce, email, subject),
  });

  expect(result3.status).toBe(200);
});

it('unlinks Google while retaining a password-authenticated session', async () => {
  const account = await f.signup();
  const subject = randomUUID();
  const begin = await account.browser.call('POST', '/google/start', { intent: 'link' });

  await account.browser.call('POST', '/google/complete', {
    flowId: begin.data.flowId,
    idToken: signed(begin.data.nonce, `${randomUUID()}@gmail.com`, subject),
  });
  const methods = await account.browser.call('GET', '/methods');
  const start = await account.browser.call('POST', '/reauth/password/start', { password: 'Synthetic password 42!' });

  await account.browser.call('POST', '/reauth/password/complete', {
    flowId: start.data.flowId,
    factor: { kind: 'email', code: f.lastCode(account.email) },
  });
  const proofTime = Date.now() - 240_000;

  await f.pool.query(
    "update auth_sessions set sess = jsonb_set(sess, '{passport,user,authenticatedAt}', to_jsonb($1::bigint)) where sess->>'csrf' = $2",
    [proofTime, account.browser.csrf],
  );
  const removed = await account.browser.call('DELETE', `/google/${methods.data.google[0].id}`);

  expect(removed.status).toBe(200);
  expect(removed.data.method).toBe('password');
  const stored = await f.pool.query(
    "select sess->'passport'->'user' as principal from auth_sessions where sess->>'csrf' = $1",
    [account.browser.csrf],
  );

  expect(stored.rows[0].principal).toMatchObject({ authenticatedAt: proofTime, secondFactor: 'email' });
});

it('can remove a password when Google remains and rejects password sign-in afterwards', async () => {
  const account = await f.signup(`${randomUUID()}@gmail.com`);
  const start = await account.browser.call('POST', '/google/start', { intent: 'link' });

  await account.browser.call('POST', '/google/complete', {
    flowId: start.data.flowId,
    idToken: signed(start.data.nonce, account.email, randomUUID()),
  });
  const reauth = await account.browser.call('POST', '/reauth/password/start', { password: 'Synthetic password 42!' });

  await account.browser.call('POST', '/reauth/password/complete', {
    flowId: reauth.data.flowId,
    factor: { kind: 'email', code: f.lastCode(account.email) },
  });
  const result1 = await account.browser.call('POST', '/password/remove', {});

  expect(result1.status).toBe(204);
  const browser = await f.client();
  const result2 = await browser.call('POST', '/password/sign-in', {
    email: account.email,
    password: 'Synthetic password 42!',
  });

  expect(result2.status).toBe(401);
});
