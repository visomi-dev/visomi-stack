import { authSchema, DATABASE, inject, type Database } from '@visomi-stack/backend-shared';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, desc, eq, gt, isNotNull, isNull, ne } from 'drizzle-orm';

import { AUTH_CONFIG, type AuthConfig } from '../shared/config';
import { Flows, unavailable } from '../shared/flows';
import { invalidate, lockEmail, lockIdentity, principal, requireFull, updatedPrincipal } from '../shared/identity';
import { requireFresh } from '../shared/security';

import { normalizeEmail } from './normalization';

const { users, flows } = authSchema;

export class EmailIdentity {
  private readonly database = inject<Database>(DATABASE);
  private readonly config = inject<AuthConfig>(AUTH_CONFIG);
  readonly flows = inject(Flows);

  async emailStart(sid: string, current: Express.User, input?: string, change = false) {
    if (change) {
      requireFull(current);
      requireFresh(current, this.config);
    }

    if (current.level !== 'unverified' && !change) {
      throw new HttpError(409, 'email_already_verified');
    }

    const email = normalizeEmail(input ?? current.email);

    await this.flows.limit('email-delivery', email, 5);
    const issued = await this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);

      if (!change && user.email && user.email !== email) {
        throw new HttpError(409, 'email_change_required');
      }

      if (!change) {
        await tx.update(users).set({ email }).where(eq(users.id, user.id));
      }

      const purpose = change ? 'email_change' : 'email_verify';
      const [previous] = await tx
        .select()
        .from(flows)
        .where(
          and(
            eq(flows.userId, user.id),
            eq(flows.purpose, purpose),
            isNull(flows.consumedAt),
            gt(flows.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(flows.createdAt))
        .limit(1)
        .for('update');

      if (previous) {
        if (previous.lastSentAt && Date.now() - previous.lastSentAt.getTime() < 60_000) {
          throw new HttpError(429, 'resend_cooldown');
        }

        if (previous.attempts >= 5) {
          throw unavailable();
        }
      }

      await tx
        .update(flows)
        .set({ consumedAt: new Date() })
        .where(and(eq(flows.userId, user.id), eq(flows.purpose, purpose), isNull(flows.consumedAt)));

      return this.flows.issue(
        tx,
        sid,
        purpose,
        {
          userId: user.id,
          authVersion: user.authVersion,
          email,
          ...(previous ? { attempts: previous.attempts, expiresAt: previous.expiresAt } : {}),
        },
        true,
      );
    });

    await this.flows.deliver(issued.flow, issued.code);
    const { flow } = issued;

    return { flowId: flow.id, expiresAt: flow.expiresAt };
  }

  async emailComplete(sid: string, current: Express.User, id: string, code: string, change = false) {
    if (change) {
      requireFull(current);
      requireFresh(current, this.config);
    }

    const reserved = await this.flows.reserve(sid, id, change ? 'email_change' : 'email_verify');

    return this.database.transaction(async (tx) => {
      await lockEmail(tx, reserved.email!);
      const user = await lockIdentity(tx, sid, current);
      const flow = await this.flows.locked(tx, sid, id, reserved.purpose);

      if (flow.userId !== user.id || flow.authVersion !== user.authVersion || (!change && user.email !== flow.email)) {
        throw unavailable();
      }

      this.flows.code(flow, code);
      const [claimed] = await tx
        .select()
        .from(users)
        .where(and(eq(users.email, flow.email!), isNotNull(users.emailVerifiedAt), ne(users.id, user.id)));

      if (claimed) {
        throw new HttpError(409, 'email_in_use');
      }

      await tx.update(users).set({ email: flow.email, emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
      await this.flows.consume(tx, flow);
      const updated = await invalidate(tx, user.id, sid);

      return {
        user: change ? updatedPrincipal(updated, current) : principal(updated, current.method!, current.methodId),
        previousEmail: change ? user.email : null,
      };
    });
  }
}
