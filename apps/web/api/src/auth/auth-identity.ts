import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import type { AuthUser } from './auth-schemas';

import { accountMemberships, accountPasskeyEnrollments, accounts, db, HttpError, safeInsert, users } from 'shared';

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeAccountSlug(email: string) {
  return normalizeEmail(email)
    .split('@')[0]
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);

  return user;
}

export async function findUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return user;
}

export async function getPrimaryMembership(userId: string) {
  const [membership] = await db
    .select()
    .from(accountMemberships)
    .where(eq(accountMemberships.userId, userId))
    .orderBy(asc(accountMemberships.createdAt))
    .limit(1);

  return membership;
}

export async function resolveAuthUser(user: typeof users.$inferSelect): Promise<AuthUser> {
  return resolveAuthUserForAccount(user);
}

export async function resolveAuthUserForAccount(
  user: typeof users.$inferSelect,
  accountId?: string,
): Promise<AuthUser> {
  const lookup = accountId
    ? db
        .select()
        .from(accountMemberships)
        .where(and(eq(accountMemberships.userId, user.id), eq(accountMemberships.accountId, accountId)))
        .limit(1)
    : getPrimaryMembership(user.id).then((membership) => [membership]);
  const [membership] = await lookup;

  if (!membership) {
    throw new HttpError({
      code: 'account_membership_missing',
      message: 'The account membership could not be found.',
      statusCode: 500,
    });
  }

  return {
    accountId: membership.accountId,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    id: user.id,
    role: membership.role,
    authVersion: user.authVersion,
  };
}

export async function findOrCreateUserByEmail(email: string): Promise<typeof users.$inferSelect> {
  const normalizedEmail = normalizeEmail(email);
  const existing = await findUserByEmail(normalizedEmail);

  if (existing) {
    return existing;
  }
  const now = DateTime.utc().toJSDate();
  const inserted = await safeInsert(
    () =>
      db.insert(users).values({ createdAt: now, email: normalizedEmail, id: randomUUID(), updatedAt: now }).returning(),
    'users_email_idx',
    {
      code: 'email_already_registered',
      message: 'An account already exists for this email address.',
      statusCode: 409,
    },
  );
  const user = (inserted as Array<typeof users.$inferSelect>)[0];

  if (!user) {
    throw new HttpError({ code: 'user_not_created', message: 'The account could not be created.', statusCode: 500 });
  }
  const accountId = randomUUID();
  const baseSlug = normalizeAccountSlug(normalizedEmail);
  const [existingAccount] = await db.select().from(accounts).where(eq(accounts.slug, baseSlug)).limit(1);
  const accountSlug = existingAccount ? `${baseSlug}-${accountId.slice(0, 8)}` : baseSlug;

  await safeInsert(
    () =>
      db.insert(accounts).values({
        createdAt: now,
        id: accountId,
        name: normalizedEmail.split('@')[0],
        ownerUserId: user.id,
        slug: accountSlug,
        updatedAt: now,
      }),
    'accounts_slug_idx',
    {
      code: 'account_slug_taken',
      message: 'An account with that slug already exists.',
      statusCode: 409,
    },
  );
  await safeInsert(
    () =>
      db
        .insert(accountMemberships)
        .values({ accountId, createdAt: now, id: randomUUID(), role: 'owner', updatedAt: now, userId: user.id }),
    'account_memberships_account_user_idx',
    {
      code: 'membership_already_exists',
      message: 'The account membership already exists.',
      statusCode: 409,
    },
  );

  return user;
}

export async function listMembershipsForUser(userId: string) {
  const memberships = await db
    .select()
    .from(accountMemberships)
    .where(eq(accountMemberships.userId, userId))
    .orderBy(asc(accountMemberships.createdAt));

  return memberships;
}

export async function createPasskeyEnrollment(
  email: string,
  accountId: string,
  existingUser?: typeof users.$inferSelect,
) {
  const user = existingUser ?? (await findOrCreateUserByEmail(email));
  const [membership] = await db
    .select()
    .from(accountMemberships)
    .where(and(eq(accountMemberships.userId, user.id), eq(accountMemberships.accountId, accountId)))
    .limit(1);

  if (!membership) {
    throw new HttpError({
      code: 'account_membership_missing',
      message: 'The account membership could not be found.',
      statusCode: 500,
    });
  }
  const now = DateTime.utc();
  const enrollmentId = randomUUID();

  await db.insert(accountPasskeyEnrollments).values({
    activatedAt: null,
    accountId: membership.accountId,
    credentialId: null,
    createdAt: now.toJSDate(),
    email: user.email,
    expiresAt: now.plus({ minutes: 15 }).toJSDate(),
    id: enrollmentId,
    status: 'pending',
    terminalAt: null,
    updatedAt: now.toJSDate(),
    userId: user.id,
    verificationChallengeId: null,
  });

  return {
    enrollmentId,
    membership: { ...membership, accountId: membership.accountId, userId: user.id },
    user,
    verificationChallengeId: null,
  };
}
