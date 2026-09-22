import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { authorizePasskeyAssertion } from './passkey-authorization';

import {
  accounts,
  accountMemberships,
  accountPasskeyCredentials,
  accountPasskeyEnrollments,
  accountWebAuthnChallenges,
  authEnrollmentGrants,
  db,
  users,
} from 'shared';

jest.mock('shared', () => {
  const actual = jest.requireActual('shared');
  const { PGlite } = jest.requireActual('@electric-sql/pglite');
  const { drizzle } = jest.requireActual('drizzle-orm/pglite');

  return { ...actual, db: drizzle(new PGlite(), { casing: 'snake_case' }) };
});

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}, 30000);
afterAll(async () => {
  await (db as unknown as { $client: PGlite }).$client.close();
});

async function fixture(source?: string) {
  const [user] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      email: `${randomUUID()}@example.test`,
      emailVerifiedAt: new Date(),
    })
    .returning();
  const accountId = randomUUID();
  const enrollmentId = randomUUID();
  const grantId = randomUUID();
  const expiresAt = new Date(Date.now() + 60_000);

  await db.insert(accounts).values({ id: accountId, name: 'Passkey account', slug: accountId, ownerUserId: user.id });
  await db.insert(accountMemberships).values({ id: randomUUID(), accountId, userId: user.id, role: 'owner' });
  const [credential] = await db
    .insert(accountPasskeyCredentials)
    .values({
      id: randomUUID(),
      accountId,
      userId: user.id,
      credentialId: randomUUID(),
      publicKey: 'verified-key',
      rpId: 'localhost',
      label: 'Laptop',
      status: source ? 'pending' : 'active',
      signCount: 1,
      enrollmentFlowId: source ? enrollmentId : null,
    })
    .returning();

  if (source) {
    await db.insert(accountPasskeyEnrollments).values({
      id: enrollmentId,
      accountId,
      userId: user.id,
      email: user.email,
      credentialId: credential.credentialId,
      expiresAt,
    });
    if (source !== 'bootstrap')
      await db.insert(authEnrollmentGrants).values({
        id: grantId,
        accountId,
        userId: user.id,
        source,
        requesterSessionHash: 'session-hash',
        expiresAt,
        consumedAt: source === 'email_recovery' ? null : new Date(),
      });
  }
  const [challenge] = await db
    .insert(accountWebAuthnChallenges)
    .values({
      id: randomUUID(),
      accountId,
      userId: user.id,
      challengeHash: randomUUID(),
      purpose: 'authentication',
      ceremonyType: 'authentication',
      sessionBinding: 'session',
      flowId: source ? enrollmentId : null,
      credentialId: source ? credential.credentialId : null,
      rpId: 'localhost',
      origin: 'http://localhost',
      userVerification: 'required',
      expiresAt,
    })
    .returning();
  const input: Parameters<typeof authorizePasskeyAssertion>[0] = {
    credential,
    user,
    challengeId: challenge.id,
    challengeHash: challenge.challengeHash,
    sessionBinding: 'session',
    newCounter: 2,
    ...(source
      ? {
          registration: {
            enrollmentId,
            authVersion: user.authVersion,
            grantId: source === 'bootstrap' ? undefined : grantId,
            requesterSessionHash: 'session-hash',
            requiresGrant: source !== 'bootstrap',
          },
        }
      : {}),
  };

  return { input, grantId, enrollmentId, authorize: () => authorizePasskeyAssertion(input) };
}

async function expectUnconsumed(input: Parameters<typeof authorizePasskeyAssertion>[0]) {
  const [challenge] = await db
    .select()
    .from(accountWebAuthnChallenges)
    .where(eq(accountWebAuthnChallenges.id, input.challengeId));
  const [credential] = await db
    .select()
    .from(accountPasskeyCredentials)
    .where(eq(accountPasskeyCredentials.id, input.credential.id));

  expect(challenge.consumedAt).toBeNull();
  expect(credential.activatedAt).toBeNull();
}

describe('atomic passkey authorization after assertion verification', () => {
  it.each(['email_recovery', 'device_approval', 'password_enrollment', 'identity_enrollment', 'bootstrap'])(
    'preserves fresh %s enrollment',
    async (source) => {
      const current = await fixture(source);

      await expect(current.authorize()).resolves.toMatchObject({ authVersion: 1 });
      const [credential] = await db
        .select()
        .from(accountPasskeyCredentials)
        .where(eq(accountPasskeyCredentials.id, current.input.credential.id));

      expect(credential.status).toBe('active');
      expect(credential.signCount).toBe(2);
    },
  );

  it.each(['email_recovery', 'device_approval', 'password_enrollment', 'identity_enrollment'])(
    'rejects %s revoked after the proof snapshot, including consumed grants',
    async (source) => {
      const current = await fixture(source);

      // Deterministic interleaving: the proof snapshot exists, revocation commits, then authorization resumes.
      await db
        .update(authEnrollmentGrants)
        .set({ revokedAt: new Date() })
        .where(eq(authEnrollmentGrants.id, current.grantId));
      await expect(current.authorize()).rejects.toMatchObject({ code: 'enrollment_grant_unavailable' });
      await expectUnconsumed(current.input);
    },
  );

  it.each([undefined, 'bootstrap', 'password_enrollment'])(
    'rejects an email/epoch change after the %s proof snapshot',
    async (source) => {
      const current = await fixture(source);

      await db
        .update(users)
        .set({ email: `${randomUUID()}@example.test`, authVersion: 2 })
        .where(eq(users.id, current.input.user.id));
      await expect(current.authorize()).rejects.toMatchObject({ code: 'credential_not_found' });
      await expectUnconsumed(current.input);
    },
  );

  it('rejects a stale registration session even when the proof read the new user epoch', async () => {
    const current = await fixture('bootstrap');
    const [fresh] = await db
      .update(users)
      .set({ authVersion: 2 })
      .where(eq(users.id, current.input.user.id))
      .returning();

    current.input.user = fresh;
    await expect(current.authorize()).rejects.toMatchObject({ code: 'authentication_required' });
    await expectUnconsumed(current.input);
  });

  it('rejects revocation committed between credential read and assertion commit', async () => {
    const current = await fixture();

    await db
      .update(accountPasskeyCredentials)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(accountPasskeyCredentials.id, current.input.credential.id));
    await expect(current.authorize()).rejects.toMatchObject({ code: 'credential_not_found' });
    await expectUnconsumed(current.input);
  });

  it('does not overwrite a concurrent assertion counter or consume its losing challenge', async () => {
    const current = await fixture();

    await db
      .update(accountPasskeyCredentials)
      .set({ signCount: 3 })
      .where(eq(accountPasskeyCredentials.id, current.input.credential.id));
    await expect(current.authorize()).rejects.toMatchObject({ code: 'credential_not_found' });
    await expectUnconsumed(current.input);
    const [credential] = await db
      .select()
      .from(accountPasskeyCredentials)
      .where(eq(accountPasskeyCredentials.id, current.input.credential.id));

    expect(credential.signCount).toBe(3);
  });

  it('retains the accepted epoch if email changes after authorization, and prevents challenge replay', async () => {
    const current = await fixture();
    const accepted = await current.authorize();

    await expect(current.authorize()).rejects.toMatchObject({ code: 'challenge_mismatch' });
    await db.update(users).set({ authVersion: 2 }).where(eq(users.id, accepted.id));
    expect(accepted.authVersion).toBe(1);
  });
});
