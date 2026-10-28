import { randomUUID } from 'node:crypto';

import { authSchema, DATABASE, inject, type Database } from '@visomi-stack/backend-shared';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, isNull } from 'drizzle-orm';

import { AUTH_CONFIG, type AuthConfig } from './config';
import { type Transaction, type User, lockIdentity, invalidate, updatedPrincipal, requireFull } from './identity';
import { unavailable } from './flows';
import { requireFresh } from './security';
import { decryptSecret, digest, encryptSecret, matches, token, totpSetup, totpStep } from './secrets';

const { totpEnrollments, recoveryCodes } = authSchema;

export type Factor = { kind: 'email' | 'totp' | 'recovery_code'; code: string };
export class Factors {
  private readonly database = inject<Database>(DATABASE);
  private readonly config = inject<AuthConfig>(AUTH_CONFIG);

  async active(tx: Transaction | Database, userId: string) {
    const [factor] = await tx
      .select()
      .from(totpEnrollments)
      .where(and(eq(totpEnrollments.userId, userId), eq(totpEnrollments.status, 'active')));

    return factor;
  }

  async verify(tx: Transaction, user: User, factor?: Factor) {
    if (!factor) {
      throw unavailable();
    }

    const enrollment = await this.active(tx, user.id);

    if (!enrollment) {
      throw unavailable();
    }

    if (factor.kind === 'totp') {
      if (!this.config.totpKey) {
        throw new HttpError(503, 'totp_unavailable');
      }

      const step = await totpStep(decryptSecret(enrollment.encryptedSecret, this.config.totpKey), factor.code);

      if (step <= enrollment.lastStep) {
        throw unavailable();
      }

      await tx.update(totpEnrollments).set({ lastStep: step }).where(eq(totpEnrollments.id, enrollment.id));

      return;
    }

    if (factor.kind === 'recovery_code') {
      const candidates = await tx
        .select()
        .from(recoveryCodes)
        .where(and(eq(recoveryCodes.userId, user.id), isNull(recoveryCodes.usedAt)));
      const hash = digest(this.config.secret, `backup:${user.id}`, factor.code.split('-').join('').toUpperCase());
      const candidate = candidates.find((c) => matches(c.codeHash, hash));

      if (!candidate) {
        throw unavailable();
      }

      const [consumed] = await tx
        .update(recoveryCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(recoveryCodes.id, candidate.id), isNull(recoveryCodes.usedAt)))
        .returning();

      if (!consumed) {
        throw unavailable();
      }

      return;
    }

    throw unavailable();
  }

  async setup(sid: string, current: Express.User) {
    requireFull(current);
    requireFresh(current, this.config);
    if (!this.config.totpKey) {
      throw new HttpError(503, 'totp_unavailable');
    }

    const setup = totpSetup(current.email!);
    const enrollmentId = randomUUID();

    await this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);

      await tx
        .update(totpEnrollments)
        .set({ status: 'revoked' })
        .where(and(eq(totpEnrollments.userId, user.id), eq(totpEnrollments.status, 'pending')));
      await tx.insert(totpEnrollments).values({
        id: enrollmentId,
        userId: user.id,
        sessionId: sid,
        authVersion: user.authVersion,
        encryptedSecret: encryptSecret(setup.secret, this.config.totpKey!),
        expiresAt: new Date(Date.now() + this.config.flowMaxAge),
      });
    });

    return { enrollmentId, ...setup };
  }

  async confirm(sid: string, current: Express.User, id: string, code: string) {
    requireFull(current);
    requireFresh(current, this.config);

    return this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);
      const [pending] = await tx
        .select()
        .from(totpEnrollments)
        .where(
          and(
            eq(totpEnrollments.id, id),
            eq(totpEnrollments.userId, user.id),
            eq(totpEnrollments.sessionId, sid),
            eq(totpEnrollments.status, 'pending'),
          ),
        )
        .for('update');

      if (
        !pending ||
        pending.authVersion !== user.authVersion ||
        pending.expiresAt <= new Date() ||
        !this.config.totpKey
      ) {
        throw unavailable();
      }

      const step = await totpStep(decryptSecret(pending.encryptedSecret, this.config.totpKey), code);

      if (step < 0) {
        throw unavailable();
      }

      await tx
        .update(totpEnrollments)
        .set({ status: 'revoked' })
        .where(and(eq(totpEnrollments.userId, user.id), eq(totpEnrollments.status, 'active')));
      await tx.update(totpEnrollments).set({ status: 'active', lastStep: step }).where(eq(totpEnrollments.id, id));
      const codes = await this.replaceCodes(tx, user.id);
      const updated = await invalidate(tx, user.id, sid);

      return { user: updatedPrincipal(updated, current), codes };
    });
  }

  async remove(sid: string, current: Express.User) {
    requireFull(current);
    requireFresh(current, this.config);

    return this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);

      await tx.update(totpEnrollments).set({ status: 'revoked' }).where(eq(totpEnrollments.userId, user.id));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
      const updated = await invalidate(tx, user.id, sid);

      return updatedPrincipal(updated, current);
    });
  }

  async replaceCodes(tx: Transaction, userId: string) {
    const codes = Array.from({ length: 10 }, token);

    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.insert(recoveryCodes).values(
      codes.map((code) => ({
        id: randomUUID(),
        userId,
        codeHash: digest(this.config.secret, `backup:${userId}`, code),
      })),
    );

    return codes;
  }

  async regenerate(sid: string, current: Express.User) {
    requireFull(current);
    requireFresh(current, this.config);

    return this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);
      const active = await this.active(tx, user.id);

      if (!active) {
        throw unavailable();
      }

      const codes = await this.replaceCodes(tx, user.id);
      const updated = await invalidate(tx, user.id, sid);

      return { user: updatedPrincipal(updated, current), codes };
    });
  }
}
