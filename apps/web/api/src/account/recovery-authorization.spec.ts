import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import {
  bindRecoveryEnrollmentSession,
  consumeRecoveryAuthorization,
  createRecoveryChallenge,
  replaceRecoveryCodes,
} from '../auth/auth-service';
import { clearMailbox, listSentMessages } from '../auth/auth-mail';
import { resetPasskeySecurityState } from '../auth/passkey-security';

import { requestEmailChange, verifyEmailChange } from './account-service';

import {
  accountMemberships,
  accounts,
  authEnrollmentGrants,
  authIdentityFlows,
  authVerificationChallenges,
  db,
  env,
  users,
  userTotpEnrollments,
  userRecoveryCodes,
} from 'shared';

jest.mock('shared', () => {
  const actual = jest.requireActual('shared');
  const { PGlite } = jest.requireActual('@electric-sql/pglite');
  const { drizzle } = jest.requireActual('drizzle-orm/pglite');

  return { ...actual, db: drizzle(new PGlite(), { casing: 'snake_case' }) };
});
jest.mock('../shared/env', () => ({
  env: { ...jest.requireActual('../shared/env').env, MAIL_TRANSPORT: 'memory', DATABASE_DRIVER: 'memory' },
}));
jest.mock('../auth/totp', () => ({
  decryptTotpSecret: () => 'test-secret',
  verifyTotpCode: async (_secret: string, code: string) => code === '123456',
  totpTimeStep: () => 1,
}));

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}, 30000);
afterAll(async () => {
  await (db as unknown as { $client: PGlite }).$client.close();
});
afterEach(() => clearMailbox());
beforeEach(() => resetPasskeySecurityState());

async function fixture() {
  const [user] = await db
    .insert(users)
    .values({ id: randomUUID(), email: `${randomUUID()}@example.test`, emailVerifiedAt: new Date() })
    .returning();
  const accountId = randomUUID();
  const sessionBinding = randomUUID();
  const flowId = randomUUID();

  await db
    .insert(accounts)
    .values({ id: accountId, name: 'Recovery workspace', slug: accountId, ownerUserId: user.id });
  await db.insert(accountMemberships).values({ id: randomUUID(), accountId, userId: user.id, role: 'owner' });
  await db.insert(authIdentityFlows).values({
    id: flowId,
    sessionBinding,
    state: 'authorize_existing_account',
    emailHash: createHmac('sha256', env.SESSION_SECRET).update(user.email).digest('hex'),
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  await createRecoveryChallenge(user, flowId, sessionBinding);
  const pin = listSentMessages().find((message) => message.challengeId === flowId)!.pin;
  const context = { userId: user.id, accountId, sessionBinding: randomUUID(), authVersion: user.authVersion };
  const pending = await requestEmailChange(context, `${randomUUID()}@example.test`);
  const newPin = listSentMessages().find((message) => message.challengeId === pending.flowId)!.pin;

  return {
    user,
    accountId,
    flowId,
    pin,
    sessionBinding,
    consume: () => consumeRecoveryAuthorization(flowId, pin, sessionBinding, 'original-session-hash'),
    changeEmail: () => verifyEmailChange(context, pending.flowId, newPin),
  };
}

describe('recovery authorization persistence and epoch serialization', () => {
  it.each(['totp', 'recovery_code'] as const)(
    'requires the enrolled factor and preserves usable %s recovery',
    async (kind) => {
      const current = await fixture();
      const enrollmentId = randomUUID();

      await db.insert(userTotpEnrollments).values({
        id: enrollmentId,
        userId: current.user.id,
        status: 'active',
        encryptedSecret: 'secret',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const [code] = await replaceRecoveryCodes(current.user.id);

      await expect(current.consume()).rejects.toMatchObject({ code: 'recovery_unavailable' });
      expect(
        await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, current.user.id)),
      ).toHaveLength(0);
      const results = await Promise.allSettled(
        [0, 1].map(() =>
          consumeRecoveryAuthorization(current.flowId, current.pin, current.sessionBinding, 'original-session-hash', {
            kind,
            code: kind === 'totp' ? '123456' : code,
          }),
        ),
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const [flow] = await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, current.flowId));

      expect(flow).toMatchObject({
        requiredFactor: 'totp',
        factorEnrollmentId: enrollmentId,
        factorEnrollmentVersion: current.user.authVersion,
      });
      const [enrollment] = await db.select().from(userTotpEnrollments).where(eq(userTotpEnrollments.id, enrollmentId));

      expect(enrollment.status).toBe('active');
      const codes = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, current.user.id));

      expect(codes.filter((item) => item.usedAt)).toHaveLength(kind === 'recovery_code' ? 1 : 0);
    },
    // Ten real scrypt hashes plus competing PGlite transactions can exceed Jest's
    // five-second default when the CI workers share a small CPU allocation.
    20_000,
  );

  it('rejects a fresh-flow cooldown bypass before invalidating the victim challenge or sending mail', async () => {
    const current = await fixture();
    const nextFlowId = randomUUID();

    await db.insert(authIdentityFlows).values({
      id: nextFlowId,
      sessionBinding: 'attacker-session',
      state: 'authorize_existing_account',
      emailHash: createHmac('sha256', env.SESSION_SECRET).update(current.user.email).digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const sent = listSentMessages().length;

    await expect(
      createRecoveryChallenge(current.user, nextFlowId, 'attacker-session', 'other-ip'),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(listSentMessages()).toHaveLength(sent);
    const [challenge] = await db
      .select()
      .from(authVerificationChallenges)
      .where(eq(authVerificationChallenges.id, current.flowId));

    expect(challenge.consumedAt).toBeNull();
    await expect(current.consume()).resolves.toMatchObject({ user: { id: current.user.id } });
  });

  it('preserves the original challenge when a duplicate issuance is rejected', async () => {
    const current = await fixture();

    // Reach the duplicate-insert boundary after the destination cooldown.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + env.PIN_RESEND_COOLDOWN_SECONDS * 1000);
    await expect(createRecoveryChallenge(current.user, current.flowId, current.sessionBinding)).rejects.toMatchObject({
      code: 'challenge_already_exists',
    });
    jest.restoreAllMocks();
    await expect(current.consume()).resolves.toMatchObject({ user: { id: current.user.id, authVersion: 1 } });
  });

  it('makes a recovery code unusable after the primary email changes', async () => {
    const current = await fixture();

    await current.changeEmail();
    await expect(current.consume()).rejects.toMatchObject({ code: 'recovery_unavailable' });
    expect(
      (await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, current.flowId)))[0].terminalAt,
    ).not.toBeNull();
    expect(
      (await db.select().from(authVerificationChallenges).where(eq(authVerificationChallenges.id, current.flowId)))[0]
        .consumedAt,
    ).not.toBeNull();
    expect(
      await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, current.user.id)),
    ).toHaveLength(0);
  });

  it('invalidates grants issued by a recovery that wins the user lock first, including consumed enrollment grants', async () => {
    const current = await fixture();
    const authorization = await current.consume();

    await bindRecoveryEnrollmentSession(authorization, 'rotated-session-hash');
    await expect(bindRecoveryEnrollmentSession(authorization, 'replayed-session-hash')).rejects.toMatchObject({
      code: 'recovery_unavailable',
    });
    await db
      .update(authEnrollmentGrants)
      .set({ consumedAt: new Date() })
      .where(eq(authEnrollmentGrants.id, authorization.grant.id));
    await current.changeEmail();
    await expect(bindRecoveryEnrollmentSession(authorization, 'another-session-hash')).rejects.toMatchObject({
      code: 'recovery_unavailable',
    });
    expect(
      (await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.id, authorization.grant.id)))[0]
        .revokedAt,
    ).not.toBeNull();
    expect(authorization.user.authVersion).toBe(1);
    expect((await db.select().from(users).where(eq(users.id, current.user.id)))[0].authVersion).toBe(2);
  });

  it('rejects mismatched or absent issuance versions without relying on terminalization', async () => {
    const current = await fixture();

    await db.update(authIdentityFlows).set({ userAuthVersion: null }).where(eq(authIdentityFlows.id, current.flowId));
    await expect(current.consume()).rejects.toMatchObject({ code: 'recovery_unavailable' });
    await db.update(authIdentityFlows).set({ userAuthVersion: 1 }).where(eq(authIdentityFlows.id, current.flowId));
    await db.update(users).set({ authVersion: 2 }).where(eq(users.id, current.user.id));
    await expect(current.consume()).rejects.toMatchObject({ code: 'recovery_unavailable' });
    expect(
      await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, current.user.id)),
    ).toHaveLength(0);
  });

  it('persists failed attempts and refuses cross-purpose proof reuse', async () => {
    const current = await fixture();
    const wrong = current.pin === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(
        consumeRecoveryAuthorization(current.flowId, wrong, current.sessionBinding, 'original-session-hash'),
      ).rejects.toMatchObject({ code: 'recovery_unavailable' });
    }
    expect(
      (await db.select().from(authVerificationChallenges).where(eq(authVerificationChallenges.id, current.flowId)))[0]
        .attemptCount,
    ).toBe(5);
    await expect(current.consume()).rejects.toMatchObject({ code: 'recovery_unavailable' });
    const other = await fixture();

    await db
      .update(authVerificationChallenges)
      .set({ purpose: 'bootstrap_recovery' })
      .where(eq(authVerificationChallenges.id, other.flowId));
    await expect(other.consume()).rejects.toMatchObject({ code: 'recovery_unavailable' });
  });

  it('terminalizes legacy recovery flows that were linked only by their challenge ID', async () => {
    const current = await fixture();

    await db
      .update(authIdentityFlows)
      .set({ userId: null, userAuthVersion: null, authorizationMethod: null, intent: 'sign_in' })
      .where(eq(authIdentityFlows.id, current.flowId));
    await current.changeEmail();
    expect(
      (await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, current.flowId)))[0].terminalAt,
    ).not.toBeNull();
    await expect(current.consume()).rejects.toMatchObject({ code: 'recovery_unavailable' });
  });

  it('allows at most one proof consumption and leaves no live recovery grants after simultaneous email change', async () => {
    const current = await fixture();
    const results = await Promise.allSettled([current.consume(), current.consume(), current.changeEmail()]);

    expect(results[2].status).toBe('fulfilled');
    expect(results.slice(0, 2).filter((result) => result.status === 'fulfilled').length).toBeLessThanOrEqual(1);
    const grants = await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, current.user.id));

    expect(grants.every((grant) => grant.revokedAt !== null)).toBe(true);
    await expect(current.consume()).rejects.toMatchObject({ code: 'recovery_unavailable' });
  });
});
