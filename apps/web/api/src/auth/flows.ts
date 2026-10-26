import { randomUUID } from 'node:crypto';

import { authSchema, type Database } from '@visomi-stack/backend-shared';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';

import type { AuthConfig } from './config';
import { lockSession, type Transaction } from './identity';
import { digest, matches, pin } from './secrets';
import { AuthMail } from './mail/messages';

const { flows, rateLimits } = authSchema;

export type Flow = typeof flows.$inferSelect;
export const unavailable = () => new HttpError(400, 'verification_failed');
export class Flows {
  constructor(
    private readonly database: Database,
    private readonly config: AuthConfig,
    private readonly mail: AuthMail,
  ) {}

  async limit(purpose: string, identity: string, maximum = 10) {
    const key = digest(this.config.secret, `limit:${purpose}`, identity);
    const result = await this.database
      .insert(rateLimits)
      .values({ key, attempts: 1, expiresAt: new Date(Date.now() + 600_000) })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          attempts: sql`CASE WHEN ${rateLimits.expiresAt} <= now() THEN 1 ELSE LEAST(${rateLimits.attempts}+1, 10001) END`,
          expiresAt: sql`CASE WHEN ${rateLimits.expiresAt} <= now() THEN now()+interval '10 minutes' ELSE ${rateLimits.expiresAt} END`,
        },
      })
      .returning();

    if (result[0].attempts > maximum) {
      throw new HttpError(429, 'rate_limited');
    }
  }

  async create(
    sid: string,
    purpose: Flow['purpose'],
    input: { userId?: string; authVersion?: number; email?: string; data?: Flow['data'] } = {},
    send = false,
  ) {
    const id = randomUUID();
    const code = pin();
    const created = await this.database.transaction(async (tx) => {
      await lockSession(tx, sid);
      const [flow] = await tx
        .insert(flows)
        .values({
          id,
          sessionId: sid,
          purpose,
          ...input,
          codeHash: send ? digest(this.config.secret, id, code) : null,
          lastSentAt: send ? new Date() : null,
          expiresAt: new Date(Date.now() + this.config.flowMaxAge),
        })
        .returning();

      return flow;
    });

    if (send) {
      try {
        await this.mail.code(input.email!, purpose, code);
      } catch {
        await this.database.update(flows).set({ consumedAt: new Date() }).where(eq(flows.id, id));

        throw new HttpError(503, 'mail_unavailable');
      }
    }

    return created;
  }

  async reserve(sid: string, id: string, purpose?: Flow['purpose']) {
    const [flow] = await this.database
      .update(flows)
      .set({ attempts: sql`${flows.attempts}+1` })
      .where(
        and(
          eq(flows.id, id),
          eq(flows.sessionId, sid),
          purpose ? eq(flows.purpose, purpose) : undefined,
          isNull(flows.consumedAt),
          gt(flows.expiresAt, new Date()),
          lt(flows.attempts, 5),
        ),
      )
      .returning();

    if (!flow) {
      throw unavailable();
    }

    return flow;
  }

  async locked(tx: Transaction, sid: string, id: string, purpose?: Flow['purpose']) {
    await lockSession(tx, sid);
    const [flow] = await tx
      .select()
      .from(flows)
      .where(
        and(
          eq(flows.id, id),
          eq(flows.sessionId, sid),
          purpose ? eq(flows.purpose, purpose) : undefined,
          isNull(flows.consumedAt),
          gt(flows.expiresAt, new Date()),
        ),
      )
      .for('update');

    if (!flow) {
      throw unavailable();
    }

    return flow;
  }

  code(flow: Flow, code: string) {
    if (!flow.codeHash || !matches(digest(this.config.secret, flow.id, code), flow.codeHash)) {
      throw unavailable();
    }
  }

  async consume(tx: Transaction, flow: Flow) {
    const [consumed] = await tx
      .update(flows)
      .set({ consumedAt: new Date() })
      .where(and(eq(flows.id, flow.id), isNull(flows.consumedAt), gt(flows.expiresAt, new Date())))
      .returning();

    if (!consumed) {
      throw unavailable();
    }
  }

  async resend(sid: string, id: string) {
    await this.limit('resend', sid);
    const code = pin();
    const flow = await this.database.transaction(async (tx) => {
      const current = await this.locked(tx, sid, id);

      if (
        !current.email ||
        !current.codeHash ||
        (current.data.requiredFactor === 'totp' && ['password_login', 'reauth'].includes(current.purpose)) ||
        current.attempts >= 5 ||
        current.purpose === 'enrollment'
      ) {
        throw unavailable();
      }

      if (current.lastSentAt && Date.now() - current.lastSentAt.getTime() < 60_000) {
        throw new HttpError(429, 'resend_cooldown');
      }

      const [updated] = await tx
        .update(flows)
        .set({ codeHash: digest(this.config.secret, id, code), lastSentAt: new Date() })
        .where(eq(flows.id, id))
        .returning();

      return updated;
    });

    const publicRecovery = flow.purpose === 'recovery' || flow.purpose === 'password_reset';

    if (publicRecovery && !flow.userId) {
      return { flowId: flow.id, expiresAt: flow.expiresAt };
    }

    try {
      await this.mail.code(flow.email!, flow.purpose, code);
    } catch {
      await this.database.update(flows).set({ consumedAt: new Date() }).where(eq(flows.id, flow.id));

      if (!publicRecovery) {
        throw new HttpError(503, 'mail_unavailable');
      }
    }

    return { flowId: flow.id, expiresAt: flow.expiresAt };
  }
}
