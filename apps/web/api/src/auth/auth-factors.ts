import { randomBytes, randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { hashSecret, verifySecret } from './auth-crypto';
import { decryptTotpSecret, totpTimeStep, verifyTotpCode } from './totp';

import { db, userRecoveryCodes, userTotpEnrollments, users } from 'shared';

type AuthTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function consumeEnrolledFactor(
  tx: AuthTransaction,
  enrollment: typeof userTotpEnrollments.$inferSelect,
  factor: { kind: 'totp' | 'recovery_code'; code: string },
): Promise<boolean> {
  if (factor.kind === 'recovery_code') {
    return consumeRecoveryCode(enrollment.userId, factor.code, tx);
  }
  const timeStep = totpTimeStep();

  if (enrollment.lastAcceptedTimeStep !== null && enrollment.lastAcceptedTimeStep >= timeStep) {
    return false;
  }
  try {
    const valid = await verifyTotpCode(
      decryptTotpSecret(enrollment.encryptedSecret, enrollment.keyVersion),
      factor.code,
      timeStep,
    );

    if (!valid) {
      return false;
    }
  } catch {
    return false;
  }
  const [accepted] = await tx
    .update(userTotpEnrollments)
    .set({ lastAcceptedTimeStep: timeStep, updatedAt: DateTime.utc().toJSDate() })
    .where(
      and(
        eq(userTotpEnrollments.id, enrollment.id),
        eq(userTotpEnrollments.status, 'active'),
        sql`(${userTotpEnrollments.lastAcceptedTimeStep} IS NULL OR ${userTotpEnrollments.lastAcceptedTimeStep} < ${timeStep})`,
      ),
    )
    .returning();

  return Boolean(accepted);
}

export function generateRecoveryCode(): string {
  const value = randomBytes(16).toString('hex').toUpperCase();

  return `${value.slice(0, 8)}-${value.slice(8)}`;
}

export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, generateRecoveryCode);
  const now = DateTime.utc().toJSDate();
  const replacements = await Promise.all(
    codes.map(async (code) => {
      const codeHash = await hashSecret(code);

      return { id: randomUUID(), userId, codeHash, createdAt: now };
    }),
  );

  await db.transaction(async (tx) => {
    // Match anonymous factor consumption: user first, then recovery-code rows.
    // Deleting codes first can deadlock with the insert's user FK key-share lock.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
    await tx.insert(userRecoveryCodes).values(replacements);
  });

  return codes;
}

export async function consumeRecoveryCode(
  userId: string,
  code: string,
  executor: AuthTransaction | typeof db = db,
): Promise<boolean> {
  const candidates = await executor
    .select()
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));

  for (const candidate of candidates) {
    const valid = await verifySecret(code.toUpperCase(), candidate.codeHash);

    if (!valid) {
      continue;
    }
    const [consumed] = await executor
      .update(userRecoveryCodes)
      .set({ usedAt: DateTime.utc().toJSDate() })
      .where(and(eq(userRecoveryCodes.id, candidate.id), isNull(userRecoveryCodes.usedAt)))
      .returning();

    return Boolean(consumed);
  }

  return false;
}
