import { randomUUID } from 'node:crypto';

import { authSchema, type Database } from '@visomi-stack/backend-shared';
import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import { and, desc, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import type { AuthConfig } from './config';
import { Factors, type Factor } from './factors';
import { Flows, unavailable } from './flows';
import {
  invalidate,
  lockEmail,
  lockIdentity,
  lockSession,
  lastMethod,
  principal,
  updatedPrincipal,
  requireFull,
  type User,
  type Principal,
} from './identity';
import { AuthMail } from './mail/messages';
import { requireFresh } from './security';
import { digest, hashPassword, normalizeEmail, verifyPassword } from './secrets';

const { users, flows, federatedIdentities, sessions, credentials } = authSchema;

export class Accounts {
  readonly flows: Flows;
  readonly factors: Factors;

  constructor(
    private readonly database: Database,
    private readonly config: AuthConfig,
    private readonly mail: AuthMail,
  ) {
    this.flows = new Flows(database, config, mail);
    this.factors = new Factors(database, config);
  }

  async signup(sid: string, emailInput: string, password: string) {
    const email = normalizeEmail(emailInput);

    await this.flows.limit('signup', email, 5);
    const passwordHash = await hashPassword(password);

    return this.database.transaction(async (tx) => {
      await lockEmail(tx, email);
      await lockSession(tx, sid);
      const [user] = await tx.insert(users).values({ id: randomUUID(), email, passwordHash }).returning();

      return principal(user, 'password');
    });
  }

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

  async signIn(sid: string, emailInput: string, password: string) {
    const email = normalizeEmail(emailInput);

    await this.flows.limit('password-login', email, 10);
    const candidates = await this.database
      .select()
      .from(users)
      .where(eq(users.email, email))
      .orderBy(sql`${users.emailVerifiedAt} desc nulls last`, users.createdAt);
    let user: User | undefined;

    for (const candidate of candidates.slice(0, 5)) {
      const matches = await verifyPassword(password, candidate.passwordHash ?? '');

      if (matches) {
        user = candidate;
        break;
      }
    }
    if (!candidates.length) {
      await verifyPassword(password, '');
    }

    if (!user) {
      throw new AuthHttpError(401, 'credentials_invalid');
    }

    const enrollment = await this.factors.active(this.database, user.id);
    const purpose = user.emailVerifiedAt ? 'password_login' : 'email_verify';
    const flow = await this.flows.create(
      sid,
      purpose,
      {
        userId: user.id,
        authVersion: user.authVersion,
        email,
        data: { method: 'password', requiredFactor: enrollment ? 'totp' : 'email', factorId: enrollment?.id },
      },
      !enrollment,
    );

    return { flowId: flow.id, factor: enrollment ? 'totp' : 'email', expiresAt: flow.expiresAt };
  }

  async loginComplete(sid: string, id: string, factor: Factor) {
    const reserved = await this.flows.reserve(sid, id);

    if (
      reserved.purpose !== 'password_login' &&
      !(reserved.purpose === 'email_verify' && reserved.data.method === 'password')
    ) {
      throw unavailable();
    }

    return this.database.transaction(async (tx) => {
      if (reserved.purpose === 'email_verify') {
        await lockEmail(tx, reserved.email!);
      }

      const [user] = await tx.select().from(users).where(eq(users.id, reserved.userId!)).for('update');
      const flow = await this.flows.locked(tx, sid, id, reserved.purpose);

      if (!user || !user.passwordHash || user.authVersion !== flow.authVersion || user.email !== flow.email) {
        throw unavailable();
      }

      const enrollment = await this.factors.active(tx, user.id);

      if (
        enrollment
          ? flow.data.requiredFactor !== 'totp' || flow.data.factorId !== enrollment.id
          : flow.data.requiredFactor !== 'email'
      ) {
        throw unavailable();
      }

      if (enrollment) {
        await this.factors.verify(tx, user, factor);
      } else {
        if (factor.kind !== 'email') {
          throw unavailable();
        }

        this.flows.code(flow, factor.code);
      }

      let updated = user;

      if (!user.emailVerifiedAt) {
        const [claimed] = await tx
          .select()
          .from(users)
          .where(and(eq(users.email, user.email!), isNotNull(users.emailVerifiedAt)));

        if (claimed) {
          throw new HttpError(409, 'email_in_use');
        }

        const [verified] = await tx
          .update(users)
          .set({ emailVerifiedAt: new Date() })
          .where(eq(users.id, user.id))
          .returning();

        updated = verified;
      }

      await this.flows.consume(tx, flow);

      return { ...principal(updated, 'password'), secondFactor: factor.kind };
    });
  }

  async reauthStart(sid: string, current: Express.User, password: string) {
    requireFull(current);
    await this.flows.limit('reauth', current.id, 10);
    const [user] = await this.database.select().from(users).where(eq(users.id, current.id));
    const valid = await verifyPassword(password, user?.passwordHash ?? '');

    if (!valid || user.authVersion !== current.version) {
      throw unavailable();
    }

    const active = await this.factors.active(this.database, user.id);
    const flow = await this.flows.create(
      sid,
      'reauth',
      {
        userId: user.id,
        authVersion: user.authVersion,
        email: user.email!,
        data: { method: 'password', requiredFactor: active ? 'totp' : 'email', factorId: active?.id },
      },
      !active,
    );

    return { flowId: flow.id, factor: active ? 'totp' : 'email', expiresAt: flow.expiresAt };
  }

  async reauthComplete(sid: string, current: Express.User, id: string, factor: Factor) {
    requireFull(current);
    await this.flows.reserve(sid, id, 'reauth');

    return this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);
      const flow = await this.flows.locked(tx, sid, id, 'reauth');

      if (flow.userId !== user.id || flow.authVersion !== user.authVersion) {
        throw unavailable();
      }

      const active = await this.factors.active(tx, user.id);

      if (
        active
          ? flow.data.factorId !== active.id || flow.data.requiredFactor !== 'totp'
          : flow.data.requiredFactor !== 'email'
      ) {
        throw unavailable();
      }

      if (active) {
        await this.factors.verify(tx, user, factor);
      } else {
        if (factor.kind !== 'email') {
          throw unavailable();
        }

        this.flows.code(flow, factor.code);
      }

      await this.flows.consume(tx, flow);

      return { ...principal(user, 'password'), secondFactor: factor.kind };
    });
  }

  async passwordChange(sid: string, current: Express.User, password: string | null, adding = false) {
    requireFull(current);
    requireFresh(current, this.config);
    let hash: string | null = null;

    if (password !== null) {
      const result1 = await hashPassword(password);

      hash = result1;
    }

    return this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);

      if (adding && user.passwordHash) {
        throw new HttpError(409, 'password_already_set');
      }

      if (!adding && !user.passwordHash) {
        throw new HttpError(409, 'password_not_set');
      }

      if (!hash) {
        await lastMethod(tx, user, 'password', undefined, Boolean(this.config.googleClientId));
      }

      await tx.update(users).set({ passwordHash: hash }).where(eq(users.id, user.id));
      const updated = await invalidate(tx, user.id, sid);

      return current.method === 'password' && !hash ? null : updatedPrincipal(updated, current);
    });
  }

  async overview(current: Express.User) {
    requireFull(current);
    const [user] = await this.database.select().from(users).where(eq(users.id, current.id));
    const providers = await this.database
      .select({ id: federatedIdentities.id })
      .from(federatedIdentities)
      .where(and(eq(federatedIdentities.userId, current.id), isNull(federatedIdentities.revokedAt)));
    const keys = await this.database
      .select({ id: credentials.id, label: credentials.label })
      .from(credentials)
      .where(
        and(eq(credentials.userId, current.id), isNull(credentials.revokedAt), isNull(credentials.pendingGrantId)),
      );
    const totp = await this.factors.active(this.database, current.id);

    return { password: Boolean(user.passwordHash), google: providers, passkeys: keys, totp: Boolean(totp) };
  }

  async listSessions(sid: string, current: Express.User) {
    requireFull(current);
    const rows = await this.database
      .select({ sid: sessions.sid, sess: sessions.sess, createdAt: sessions.createdAt, expire: sessions.expire })
      .from(sessions)
      .where(
        and(
          sql`${sessions.sess}->'passport'->'user'->>'id' = ${current.id}`,
          isNull(sessions.revokedAt),
          sql`${sessions.expire} > now()`,
        ),
      );

    return rows.map((row) => ({
      id: this.sessionHandle(row.sid),
      current: row.sid === sid,
      createdAt: row.createdAt,
      expiresAt: row.expire,
      method: (row.sess as { passport?: { user?: Principal } }).passport?.user?.method,
    }));
  }

  async closeSessions(sid: string, current: Express.User, handle?: string) {
    requireFull(current);
    requireFresh(current, this.config);

    return this.database.transaction(async (tx) => {
      await lockIdentity(tx, sid, current);
      const rows = await tx
        .select({ sid: sessions.sid })
        .from(sessions)
        .where(and(sql`${sessions.sess}->'passport'->'user'->>'id' = ${current.id}`, isNull(sessions.revokedAt)));
      const selected = rows.filter((row) => (handle ? this.sessionHandle(row.sid) === handle : row.sid !== sid));

      if (handle && !selected.length) {
        throw new HttpError(404, 'session_not_found');
      }

      for (const row of selected) {
        await tx
          .update(sessions)
          .set({ revokedAt: new Date(), expire: new Date(0), sess: {} })
          .where(eq(sessions.sid, row.sid));
      }

      return selected.some((row) => row.sid === sid);
    });
  }

  async notify(email: string | null, message: string) {
    if (!email) {
      return false;
    }

    try {
      await this.mail.notice(email, message);

      return true;
    } catch {
      return false;
    }
  }

  private sessionHandle(sid: string) {
    // Public handles cannot be replayed as session cookies.
    return digest(this.config.secret, 'session-handle', sid);
  }
}
