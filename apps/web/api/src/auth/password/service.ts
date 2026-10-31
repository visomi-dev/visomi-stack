import { randomUUID } from 'node:crypto';

import { authSchema, DATABASE, inject, type Database } from '@visomi-stack/backend-shared';
import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { normalizeEmail } from '../email/normalization';
import { AUTH_CONFIG, type AuthConfig } from '../shared/config';
import { Flows, unavailable } from '../shared/flows';
import {
  invalidate,
  lastMethod,
  lockEmail,
  lockIdentity,
  lockSession,
  principal,
  requireFull,
  updatedPrincipal,
  type User,
} from '../shared/identity';
import { requireFresh } from '../shared/security';
import { Factors, type Factor } from '../totp/service';

import { hashPassword, verifyPassword } from './crypto';

const { users } = authSchema;

export class Passwords {
  private readonly database = inject<Database>(DATABASE);
  private readonly config = inject<AuthConfig>(AUTH_CONFIG);
  readonly flows = inject(Flows);
  readonly factors = inject(Factors);

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
}
