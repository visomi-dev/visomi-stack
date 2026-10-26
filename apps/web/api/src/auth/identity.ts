import { authSchema, type Database } from '@visomi-stack/backend-shared';
import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';

const { users, credentials, sessions, federatedIdentities, flows } = authSchema;

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type User = typeof users.$inferSelect;
export type Principal = {
  id: string;
  method: 'passkey' | 'password' | 'google' | 'recovery' | 'device';
  methodId?: string;
  credentialId?: string;
  authenticatedAt: number;
  version: number;
  level: 'unverified' | 'full' | 'recovery' | 'enrollment';
  email: string | null;
  emailVerified: boolean;
  secondFactor?: 'email' | 'totp' | 'recovery_code';
  grantId?: string;
};

export function principal(
  user: User,
  method: Principal['method'],
  methodId?: string,
  level: Principal['level'] = user.emailVerifiedAt ? 'full' : 'unverified',
): Principal {
  return {
    id: user.id,
    method,
    methodId,
    ...(method === 'passkey' ? { credentialId: methodId } : {}),
    authenticatedAt: Date.now(),
    version: user.authVersion,
    level,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

export function validPrincipal(value: unknown): value is Principal {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const user = value as Partial<Principal>;

  return (
    typeof user.id === 'string' &&
    typeof user.version === 'number' &&
    Number.isInteger(user.version) &&
    user.version > 0 &&
    typeof user.authenticatedAt === 'number' &&
    Number.isFinite(user.authenticatedAt) &&
    user.authenticatedAt <= Date.now() &&
    ['passkey', 'password', 'google', 'recovery', 'device'].includes(user.method ?? '') &&
    ['unverified', 'full', 'recovery', 'enrollment'].includes(user.level ?? '') &&
    (user.method === 'password' || typeof user.methodId === 'string')
  );
}

export function requireFull(user?: Express.User): Principal {
  if (!validPrincipal(user)) {
    throw new AuthHttpError(401, 'authentication_required');
  }

  if (user.level !== 'full' || !user.emailVerified) {
    throw new AuthHttpError(403, 'account_verification_required');
  }

  return user;
}

export async function lockSession(tx: Transaction, sid: string) {
  const [active] = await tx
    .select()
    .from(sessions)
    .where(and(eq(sessions.sid, sid), isNull(sessions.revokedAt), gt(sessions.expire, new Date())))
    .for('update');

  if (!active) {
    throw new AuthHttpError(401, 'session_expired');
  }

  return active;
}

export async function activeMethod(tx: Transaction | Database, user: Principal): Promise<boolean> {
  if (user.grantId || user.method === 'recovery' || user.method === 'device') {
    const [grant] = await tx
      .select()
      .from(flows)
      .where(
        and(
          eq(flows.id, user.grantId ?? user.methodId!),
          eq(flows.userId, user.id),
          eq(flows.authVersion, user.version),
          eq(flows.purpose, 'enrollment'),
          isNull(flows.consumedAt),
          gt(flows.expiresAt, new Date()),
        ),
      );

    if (!grant || (user.level !== 'recovery' && user.level !== 'enrollment')) {
      return false;
    }
  }

  if (user.method === 'passkey') {
    const [key] = await tx
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, user.methodId!), eq(credentials.userId, user.id), isNull(credentials.revokedAt)));

    return Boolean(key && (!key.pendingGrantId || key.pendingGrantId === user.grantId));
  }

  if (user.method === 'google') {
    const [provider] = await tx
      .select()
      .from(federatedIdentities)
      .where(
        and(
          eq(federatedIdentities.id, user.methodId!),
          eq(federatedIdentities.userId, user.id),
          isNull(federatedIdentities.revokedAt),
        ),
      );

    return Boolean(provider);
  }

  return true;
}

export async function readPrincipal(database: Database, serialized: unknown): Promise<Principal | false> {
  if (!validPrincipal(serialized)) {
    return false;
  }

  const [user] = await database.select().from(users).where(eq(users.id, serialized.id));

  if (!user || user.authVersion !== serialized.version || (serialized.method === 'password' && !user.passwordHash)) {
    return false;
  }

  const active = await activeMethod(database, serialized);

  if (!active) {
    return false;
  }

  return {
    ...serialized,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    level: serialized.level === 'full' && !user.emailVerifiedAt ? 'unverified' : serialized.level,
  };
}

export async function lockIdentity(tx: Transaction, sid: string, current: Express.User) {
  if (!validPrincipal(current)) {
    throw new AuthHttpError(401, 'authentication_required');
  }

  const [user] = await tx.select().from(users).where(eq(users.id, current.id)).for('update');

  await lockSession(tx, sid);
  const active = await activeMethod(tx, current);

  if (
    !user ||
    user.authVersion !== current.version ||
    !active ||
    (current.method === 'password' && !user.passwordHash)
  ) {
    throw new AuthHttpError(401, 'authentication_required');
  }

  if (current.grantId || current.method === 'recovery' || current.method === 'device') {
    const [grant] = await tx
      .select()
      .from(flows)
      .where(and(eq(flows.id, current.grantId ?? current.methodId!), eq(flows.sessionId, sid)));

    if (!grant) {
      throw new AuthHttpError(401, 'authentication_required');
    }
  }

  return user;
}

export async function revokeSessions(tx: Transaction, userId: string, exceptSid?: string) {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date(), expire: new Date(0), sess: {} })
    .where(
      and(
        sql`${sessions.sess}->'passport'->'user'->>'id' = ${userId}`,
        isNull(sessions.revokedAt),
        exceptSid ? ne(sessions.sid, exceptSid) : undefined,
      ),
    );
}

export async function invalidate(tx: Transaction, userId: string, exceptSid?: string) {
  const [updated] = await tx
    .update(users)
    .set({ authVersion: sql`${users.authVersion} + 1` })
    .where(eq(users.id, userId))
    .returning();

  await revokeSessions(tx, userId, exceptSid);
  await tx
    .update(flows)
    .set({ consumedAt: new Date() })
    .where(and(eq(flows.userId, userId), isNull(flows.consumedAt)));

  return updated;
}

export async function lockEmail(tx: Transaction, email: string) {
  // Serialize claims without retaining arbitrary email strings in operational telemetry.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`);
}

export async function lastMethod(
  tx: Transaction,
  user: User,
  removing: 'passkey' | 'password' | 'google',
  id?: string,
  googleEnabled = true,
) {
  const keys = await tx
    .select()
    .from(credentials)
    .where(and(eq(credentials.userId, user.id), isNull(credentials.revokedAt), isNull(credentials.pendingGrantId)));
  const providers = await tx
    .select()
    .from(federatedIdentities)
    .where(and(eq(federatedIdentities.userId, user.id), isNull(federatedIdentities.revokedAt)));

  if (
    !(removing !== 'password' && user.passwordHash && user.emailVerifiedAt) &&
    !keys.some((k) => removing !== 'passkey' || k.id !== id) &&
    !(googleEnabled && providers.some((p) => removing !== 'google' || p.id !== id))
  ) {
    throw new HttpError(409, 'last_access_method');
  }
}
