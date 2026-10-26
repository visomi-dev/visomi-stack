import { randomUUID } from 'node:crypto';

import { authSchema, type Database } from '@visomi-stack/backend-shared';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import type { AuthConfig } from './config';
import { validateApproval } from './devices';
import { Factors, type Factor } from './factors';
import { Flows, unavailable, type Flow } from './flows';
import {
  invalidate,
  lockIdentity,
  lockSession,
  principal,
  type Principal,
  type Transaction,
  type User,
} from './identity';
import { requireFresh } from './security';
import { digest, pin, hashPassword, normalizeEmail, verifyPassword } from './secrets';

const { users, flows, credentials } = authSchema;

export async function completeEnrollment(
  tx: Transaction,
  user: User,
  grant: Flow,
  sid: string,
  method: 'passkey' | 'password',
  methodId?: string,
) {
  if (
    grant.userId !== user.id ||
    grant.authVersion !== user.authVersion ||
    !grant.data.factorProven ||
    grant.purpose !== 'enrollment'
  ) {
    throw unavailable();
  }

  if (grant.data.sourceApprovalId) {
    await validateApproval(tx, grant.data.sourceApprovalId, user.id, user.authVersion);
  }

  if (method === 'passkey') {
    await tx
      .update(credentials)
      .set({ pendingGrantId: null })
      .where(
        and(eq(credentials.id, methodId!), eq(credentials.pendingGrantId, grant.id), eq(credentials.userId, user.id)),
      );
  } else {
    await tx.update(users).set({ passwordHash: grant.data.passwordHash! }).where(eq(users.id, user.id));
  }

  const updated = await invalidate(tx, user.id, sid);

  return principal(updated, method, methodId);
}
export class Recovery {
  constructor(
    private readonly database: Database,
    private readonly config: AuthConfig,
    private readonly proofs: Flows,
    private readonly factors: Factors,
  ) {}

  async request(sid: string, input: string, reset = false, current?: Express.User) {
    const email = normalizeEmail(input);

    await this.proofs.limit(reset ? 'password-reset' : 'recovery', email, 5);
    const [user] = await this.database
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNotNull(users.emailVerifiedAt)));
    let factorProven = false;

    if (current?.id === user?.id && current?.level === 'full') {
      requireFresh(current, this.config);
      factorProven = true;
    }

    let factor: Awaited<ReturnType<Factors['active']>>;

    if (user) {
      const result1 = await this.factors.active(this.database, user.id);

      factor = result1;
    }

    // Unknown identities have the same public shape, but no usable challenge.
    const flow = await this.proofs.create(sid, reset ? 'password_reset' : 'recovery', {
      userId: user?.id,
      authVersion: user?.authVersion,
      email,
      data: { requiredFactor: factor ? 'totp' : 'email', factorId: factor?.id, factorProven },
    });

    await this.database
      .update(flows)
      .set({ codeHash: digest(this.config.secret, flow.id, pin()), lastSentAt: new Date() })
      .where(eq(flows.id, flow.id));

    if (user && (!reset || user.passwordHash)) {
      try {
        const sent = await this.proofs.create(
          sid,
          flow.purpose,
          { userId: user.id, authVersion: user.authVersion, email, data: flow.data },
          true,
        );

        await this.database.update(flows).set({ consumedAt: new Date() }).where(eq(flows.id, flow.id));

        return { flowId: sent.id, expiresAt: sent.expiresAt };
      } catch {
        // Public recovery responses cannot distinguish a missing identity from delivery failure.
        return { flowId: flow.id, expiresAt: flow.expiresAt };
      }
    }

    return { flowId: flow.id, expiresAt: flow.expiresAt };
  }

  async verify(sid: string, id: string, code: string, factor?: Factor, resetPassword?: string, current?: Express.User) {
    const reserved = await this.proofs.reserve(sid, id, resetPassword === undefined ? 'recovery' : 'password_reset');
    let passwordHash: string | undefined;

    if (resetPassword !== undefined) {
      const result2 = await hashPassword(resetPassword);

      passwordHash = result2;
    }

    return this.database.transaction(async (tx) => {
      if (!reserved.userId) {
        throw unavailable();
      }

      const [user] = await tx.select().from(users).where(eq(users.id, reserved.userId)).for('update');
      const flow = await this.proofs.locked(tx, sid, id, reserved.purpose);

      if (!user || !user.emailVerifiedAt || user.email !== flow.email || user.authVersion !== flow.authVersion) {
        throw unavailable();
      }

      this.proofs.code(flow, code);
      const active = await this.factors.active(tx, user.id);
      let proven = false;

      if (current?.id === user.id && current.level === 'full') {
        requireFresh(current, this.config);
        await lockIdentity(tx, sid, current);
        proven = true;
      }

      if (active && !proven) {
        if (flow.data.factorId !== active.id || flow.data.requiredFactor !== 'totp') {
          throw unavailable();
        }

        await this.factors.verify(tx, user, factor);
      }

      await this.proofs.consume(tx, flow);
      if (passwordHash) {
        if (!user.passwordHash) {
          throw unavailable();
        }

        await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
        await invalidate(tx, user.id);

        return { user: null, email: user.email };
      }

      const grantId = randomUUID();

      await tx.insert(flows).values({
        id: grantId,
        userId: user.id,
        sessionId: sid,
        authVersion: user.authVersion,
        purpose: 'enrollment',
        email: user.email,
        data: { factorProven: true },
        expiresAt: new Date(Date.now() + this.config.flowMaxAge),
      });

      return { user: { ...principal(user, 'recovery', grantId, 'recovery'), grantId }, email: user.email };
    });
  }

  async bindGrant(previousSid: string, newSid: string, current: Principal) {
    if (!current.grantId) {
      return;
    }

    await this.database.transaction(async (tx) => {
      await lockSession(tx, newSid);
      const [moved] = await tx
        .update(flows)
        .set({ sessionId: newSid })
        .where(
          and(
            eq(flows.id, current.grantId!),
            eq(flows.sessionId, previousSid),
            eq(flows.userId, current.id),
            eq(flows.authVersion, current.version),
            isNull(flows.consumedAt),
          ),
        )
        .returning();

      if (!moved) {
        throw unavailable();
      }
    });
  }

  async password(sid: string, current: Express.User, password: string) {
    if (!current.grantId || !['recovery', 'enrollment'].includes(current.level ?? '')) {
      throw unavailable();
    }

    const passwordHash = await hashPassword(password);

    await this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);
      const grant = await this.proofs.locked(tx, sid, current.grantId!, 'enrollment');

      if (grant.userId !== user.id || grant.authVersion !== user.authVersion) {
        throw unavailable();
      }

      await tx
        .update(flows)
        .set({ data: { ...grant.data, passwordHash } })
        .where(eq(flows.id, grant.id));
    });
    const enrollment = await this.factors.active(this.database, current.id);
    const flow = await this.proofs.create(
      sid,
      'enrollment',
      {
        userId: current.id,
        authVersion: current.version,
        email: current.email!,
        data: {
          method: 'password',
          methodId: current.grantId,
          requiredFactor: enrollment ? 'totp' : 'email',
          factorId: enrollment?.id,
        },
      },
      !enrollment,
    );

    return { flowId: flow.id, factor: enrollment ? 'totp' : 'email', expiresAt: flow.expiresAt };
  }

  async passwordComplete(sid: string, current: Express.User, id: string, password: string, factor: Factor) {
    await this.proofs.reserve(sid, id, 'enrollment');

    return this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);
      const grant = await this.proofs.locked(tx, sid, current.grantId!, 'enrollment');
      const proof = await this.proofs.locked(tx, sid, id, 'enrollment');

      if (
        proof.userId !== user.id ||
        proof.authVersion !== user.authVersion ||
        proof.data.methodId !== grant.id ||
        !grant.data.passwordHash
      ) {
        throw unavailable();
      }

      const valid = await verifyPassword(password, grant.data.passwordHash);

      if (!valid) {
        throw unavailable();
      }

      const active = await this.factors.active(tx, user.id);

      if (active) {
        if (proof.data.factorId !== active.id || proof.data.requiredFactor !== 'totp') {
          throw unavailable();
        }

        await this.factors.verify(tx, user, factor);
      } else {
        if (factor.kind !== 'email') {
          throw unavailable();
        }

        this.proofs.code(proof, factor.code);
      }

      await this.proofs.consume(tx, proof);

      return completeEnrollment(tx, user, grant, sid, 'password');
    });
  }
}
