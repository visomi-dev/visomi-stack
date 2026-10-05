import { createHash } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { db } from '../db/client';
import { vaultBrowserEnrollments, vaultUnlockAssertions } from '../db/schema';

/** Trusted session-store callback only; never accept a caller-supplied SID from an HTTP body. */
export async function revokeSessionVaultCustody(sessionId: string): Promise<void> {
  const hash = createHash('sha256').update(sessionId).digest('hex');

  await db.transaction(async (tx) => {
    await tx
      .update(vaultBrowserEnrollments)
      .set({ envelope: null, revokedAt: DateTime.utc().toJSDate() })
      .where(and(eq(vaultBrowserEnrollments.sessionHash, hash), isNull(vaultBrowserEnrollments.revokedAt)));
    await tx.delete(vaultUnlockAssertions).where(eq(vaultUnlockAssertions.sessionHash, hash));
  });
}
