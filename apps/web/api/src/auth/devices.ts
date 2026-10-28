import { randomUUID } from 'node:crypto';

import { authSchema, DATABASE, inject, type Database } from '@visomi-stack/backend-shared';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';

import { AUTH_CONFIG, type AuthConfig } from './config';
import { Flows, unavailable } from './flows';
import {
  activeMethod,
  lockIdentity,
  lockSession,
  principal,
  requireFull,
  type Principal,
  type Transaction,
} from './identity';
import { requireFresh } from './security';
import { digest, matches, normalizeEmail, pin } from './secrets';

const { deviceApprovals, users, flows, sessions } = authSchema;

export async function validateApproval(tx: Transaction, id: string, userId: string, version: number) {
  const [approval] = await tx
    .select()
    .from(deviceApprovals)
    .where(
      and(eq(deviceApprovals.id, id), eq(deviceApprovals.userId, userId), gt(deviceApprovals.expiresAt, new Date())),
    );
  const proof = approval?.approver;

  if (!approval || !proof || !['approved', 'consumed'].includes(approval.status) || proof.version !== version) {
    throw unavailable();
  }

  const [session] = await tx
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.sid, approval.approverSessionId!), isNull(sessions.revokedAt), gt(sessions.expire, new Date())),
    );
  const valid = await activeMethod(tx, { id: userId, ...proof, level: 'full', email: null, emailVerified: true });

  if (!session || !valid) {
    throw unavailable();
  }

  return approval;
}
export class Devices {
  private readonly database = inject<Database>(DATABASE);
  private readonly config = inject<AuthConfig>(AUTH_CONFIG);
  private readonly proofs = inject(Flows);

  async request(sid: string, emailInput: string) {
    const email = normalizeEmail(emailInput);

    await this.proofs.limit('device-request', email, 5);
    const id = randomUUID();
    const userCode = pin();

    await this.database.transaction(async (tx) => {
      await lockSession(tx, sid);
      await tx.insert(deviceApprovals).values({
        id,
        email,
        sessionId: sid,
        codeHash: digest(this.config.secret, `device:${id}`, userCode),
        expiresAt: new Date(Date.now() + this.config.flowMaxAge),
      });
    });

    return { requestId: id, userCode, expiresAt: new Date(Date.now() + this.config.flowMaxAge) };
  }

  async status(sid: string, id: string) {
    const [request] = await this.database
      .select()
      .from(deviceApprovals)
      .where(and(eq(deviceApprovals.id, id), eq(deviceApprovals.sessionId, sid)));

    if (!request) {
      throw unavailable();
    }

    return {
      requestId: id,
      status: request.expiresAt <= new Date() ? 'expired' : request.status,
      expiresAt: request.expiresAt,
    };
  }

  async review(sid: string, current: Express.User, id: string) {
    requireFull(current);

    return this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);
      const [request] = await tx
        .select()
        .from(deviceApprovals)
        .where(
          and(
            eq(deviceApprovals.id, id),
            eq(deviceApprovals.email, user.email!),
            gt(deviceApprovals.expiresAt, new Date()),
          ),
        );

      if (!request || request.sessionId === sid) {
        throw unavailable();
      }

      return { requestId: id, status: request.status, expiresAt: request.expiresAt };
    });
  }

  async decide(sid: string, current: Express.User, id: string, approve: boolean, code: string) {
    const full = requireFull(current);

    requireFresh(current, this.config);
    await this.proofs.limit('device-approve', full.id, 10);
    const [reserved] = await this.database
      .update(deviceApprovals)
      .set({ attempts: sql`${deviceApprovals.attempts}+1` })
      .where(
        and(
          eq(deviceApprovals.id, id),
          eq(deviceApprovals.status, 'pending'),
          gt(deviceApprovals.expiresAt, new Date()),
          lt(deviceApprovals.attempts, 5),
        ),
      )
      .returning();

    if (!reserved || !matches(digest(this.config.secret, `device:${id}`, code), reserved.codeHash)) {
      throw unavailable();
    }

    await this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);

      if (reserved.email !== user.email || reserved.sessionId === sid) {
        throw unavailable();
      }

      const [updated] = await tx
        .update(deviceApprovals)
        .set({
          status: approve ? 'approved' : 'denied',
          userId: user.id,
          approverSessionId: sid,
          approver: {
            method: full.method as 'passkey' | 'password' | 'google',
            methodId: full.methodId,
            authenticatedAt: full.authenticatedAt,
            version: user.authVersion,
          },
        })
        .where(
          and(
            eq(deviceApprovals.id, id),
            eq(deviceApprovals.status, 'pending'),
            gt(deviceApprovals.expiresAt, new Date()),
          ),
        )
        .returning();

      if (!updated) {
        throw unavailable();
      }
    });
  }

  async cancel(sid: string, id: string) {
    await this.database.transaction(async (tx) => {
      await lockSession(tx, sid);
      const [updated] = await tx
        .update(deviceApprovals)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(deviceApprovals.id, id),
            eq(deviceApprovals.sessionId, sid),
            sql`${deviceApprovals.status} IN ('pending','approved')`,
            gt(deviceApprovals.expiresAt, new Date()),
          ),
        )
        .returning();

      if (!updated) {
        throw unavailable();
      }
    });
  }

  async consume(sid: string, id: string, code: string): Promise<Principal> {
    const [reserved] = await this.database
      .update(deviceApprovals)
      .set({ attempts: sql`${deviceApprovals.attempts}+1` })
      .where(
        and(
          eq(deviceApprovals.id, id),
          eq(deviceApprovals.sessionId, sid),
          eq(deviceApprovals.status, 'approved'),
          gt(deviceApprovals.expiresAt, new Date()),
          lt(deviceApprovals.attempts, 5),
        ),
      )
      .returning();

    if (!reserved || !matches(digest(this.config.secret, `device:${id}`, code), reserved.codeHash)) {
      throw unavailable();
    }

    return this.database.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, reserved.userId!)).for('update');

      await lockSession(tx, sid);
      if (!user) {
        throw unavailable();
      }

      await validateApproval(tx, id, user.id, user.authVersion);
      const [consumed] = await tx
        .update(deviceApprovals)
        .set({ status: 'consumed' })
        .where(and(eq(deviceApprovals.id, id), eq(deviceApprovals.status, 'approved')))
        .returning();

      if (!consumed) {
        throw unavailable();
      }

      const grantId = randomUUID();

      await tx.insert(flows).values({
        id: grantId,
        userId: user.id,
        authVersion: user.authVersion,
        sessionId: sid,
        purpose: 'enrollment',
        email: user.email,
        data: { factorProven: true, sourceApprovalId: id },
        expiresAt: new Date(Date.now() + this.config.flowMaxAge),
      });

      return { ...principal(user, 'device', grantId, 'enrollment'), grantId };
    });
  }
}
