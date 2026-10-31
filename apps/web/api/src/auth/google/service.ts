import { randomBytes, randomUUID } from 'node:crypto';

import { authSchema, DATABASE, inject, type Database } from '@visomi-stack/backend-shared';
import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';

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

const { users, credentials, flows, federatedIdentities } = authSchema;

export class Google {
  private readonly database = inject<Database>(DATABASE);
  private readonly config = inject<AuthConfig>(AUTH_CONFIG);
  private readonly proofs = inject(Flows);

  private readonly client = new OAuth2Client(this.config.googleClientId);

  async start(sid: string, intent: 'login' | 'link' | 'reauth', current?: Express.User) {
    if (!this.config.googleClientId) {
      throw new HttpError(404, 'google_disabled');
    }

    if (intent !== 'login') {
      requireFull(current);
    }

    if (intent === 'link') {
      requireFresh(current, this.config);
    }

    const nonce = randomBytes(32).toString('base64url');
    const flow = await this.proofs.create(sid, `google_${intent}`, {
      ...(intent === 'login' ? {} : { userId: current!.id, authVersion: current!.version }),
      data: { nonce },
    });

    return { flowId: flow.id, nonce, clientId: this.config.googleClientId, expiresAt: flow.expiresAt };
  }

  async complete(sid: string, id: string, idToken: string, current?: Express.User) {
    if (!this.config.googleClientId) {
      throw new HttpError(404, 'google_disabled');
    }

    const reserved = await this.proofs.reserve(sid, id);

    if (!['google_login', 'google_link', 'google_reauth'].includes(reserved.purpose) || !reserved.data.nonce) {
      throw unavailable();
    }

    let payload: TokenPayload | undefined;

    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.config.googleClientId });

      payload = ticket.getPayload();
    } catch {
      throw new AuthHttpError(401, 'google_token_invalid');
    }

    if (
      !payload ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
      payload.nonce !== reserved.data.nonce ||
      !payload.sub ||
      !payload.email ||
      payload.email_verified !== true ||
      !payload.exp ||
      payload.exp * 1000 <= Date.now()
    ) {
      throw new AuthHttpError(401, 'google_token_invalid');
    }

    const email = normalizeEmail(payload.email);
    const authoritative = email.endsWith('@gmail.com') || Boolean(payload.hd);
    const issuer = 'https://accounts.google.com';

    // Burn the provider nonce before applying the result or sending another challenge.
    await this.database.transaction(async (tx) => {
      const flow = await this.proofs.locked(tx, sid, id, reserved.purpose);

      if (flow.data.nonce !== reserved.data.nonce) {
        throw unavailable();
      }

      await tx
        .update(flows)
        .set({ data: { issuer, subject: payload!.sub, providerEmail: email } })
        .where(eq(flows.id, id));
    });

    if (!authoritative) {
      const next = await this.proofs.create(
        sid,
        reserved.purpose,
        {
          userId: reserved.userId ?? undefined,
          authVersion: reserved.authVersion ?? undefined,
          email,
          data: { issuer, subject: payload.sub, providerEmail: email },
        },
        true,
      );

      await this.database.update(flows).set({ consumedAt: new Date() }).where(eq(flows.id, id));

      return { pending: { flowId: next.id, expiresAt: next.expiresAt, factor: 'email' } };
    }

    const user = await this.finish(sid, id, current);

    return { user };
  }

  async emailComplete(sid: string, id: string, code: string, current?: Express.User) {
    const flow = await this.proofs.reserve(sid, id);

    this.proofs.code(flow, code);

    return this.finish(sid, id, current, code);
  }

  async unlink(sid: string, current: Express.User, identityId: string) {
    requireFull(current);
    requireFresh(current, this.config);

    return this.database.transaction(async (tx) => {
      const user = await lockIdentity(tx, sid, current);
      const [identity] = await tx
        .select()
        .from(federatedIdentities)
        .where(
          and(
            eq(federatedIdentities.id, identityId),
            eq(federatedIdentities.userId, user.id),
            isNull(federatedIdentities.revokedAt),
          ),
        );

      if (!identity) {
        throw new HttpError(404, 'identity_not_found');
      }

      await lastMethod(tx, user, 'google', identityId, Boolean(this.config.googleClientId));

      await tx.update(federatedIdentities).set({ revokedAt: new Date() }).where(eq(federatedIdentities.id, identityId));

      const updated = await invalidate(tx, user.id, sid);

      return current.method === 'google' && current.methodId === identityId ? null : updatedPrincipal(updated, current);
    });
  }

  private async finish(sid: string, id: string, current?: Express.User, code?: string) {
    // Email lock precedes every identity lock, including local email verification.
    return this.database.transaction(async (tx) => {
      const [candidate] = await tx.select().from(flows).where(eq(flows.id, id));

      if (
        !candidate?.data.subject ||
        !candidate.data.issuer ||
        !candidate.data.providerEmail ||
        !['google_login', 'google_link', 'google_reauth'].includes(candidate.purpose)
      ) {
        throw unavailable();
      }

      const { issuer, subject, providerEmail: email } = candidate.data;

      // A provider subject can race across sessions with different provider emails.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${issuer + ':' + subject}, 1))`);

      await lockEmail(tx, email);

      let [linked] = await tx
        .select()
        .from(federatedIdentities)
        .where(and(eq(federatedIdentities.issuer, issuer), eq(federatedIdentities.subject, subject)));
      let user: User | undefined;

      if (candidate.purpose !== 'google_login') {
        requireFull(current);

        if (candidate.purpose === 'google_link') {
          requireFresh(current, this.config);
        }

        const result1 = await lockIdentity(tx, sid, current!);

        user = result1;

        if (
          candidate.userId !== user.id ||
          candidate.authVersion !== user.authVersion ||
          (linked && linked.userId !== user.id)
        ) {
          throw new HttpError(409, 'google_identity_in_use');
        }

        if (candidate.purpose === 'google_reauth' && (!linked || linked.revokedAt)) {
          throw unavailable();
        }
      } else {
        if (linked) {
          // A revoked link never becomes anonymous account-merge authority.
          if (linked.revokedAt) {
            throw new HttpError(409, 'google_link_required');
          }

          const result2 = await tx.select().from(users).where(eq(users.id, linked.userId)).for('update');

          [user] = result2;
        } else {
          const result3 = await tx
            .select()
            .from(users)
            .where(and(eq(users.email, email), isNotNull(users.emailVerifiedAt)))
            .for('update');

          [user] = result3;

          if (!user) {
            const result4 = await tx
              .select()
              .from(users)
              .where(and(eq(users.email, email), isNull(users.emailVerifiedAt)))
              .orderBy(users.createdAt)
              .for('update');

            [user] = result4;
          }
        }

        await lockSession(tx, sid);
      }

      const flow = await this.proofs.locked(tx, sid, id, candidate.purpose);

      if (code !== undefined) {
        this.proofs.code(flow, code);
      } else if (flow.codeHash) {
        throw unavailable();
      }

      if (!user) {
        const result5 = await tx
          .insert(users)
          .values({ id: randomUUID(), email, emailVerifiedAt: new Date() })
          .returning();

        [user] = result5;
      } else if (!user.emailVerifiedAt) {
        // A Google owner must not inherit access planted by an unverified signup.
        await tx.update(credentials).set({ revokedAt: new Date() }).where(eq(credentials.userId, user.id));

        await tx
          .update(users)
          .set({ email, emailVerifiedAt: new Date(), passwordHash: null })
          .where(eq(users.id, user.id));

        const result6 = await invalidate(tx, user.id);

        user = result6;
      }

      if (!linked) {
        const result7 = await tx
          .insert(federatedIdentities)
          .values({ id: randomUUID(), userId: user.id, issuer, subject })
          .returning();

        [linked] = result7;
      } else if (linked.revokedAt) {
        await tx.update(federatedIdentities).set({ revokedAt: null }).where(eq(federatedIdentities.id, linked.id));
      }

      // Invalidating an unverified identity also consumes its old flows; this login flow is still anonymous.
      await this.proofs.consume(tx, flow);

      return principal(user, 'google', linked.id);
    });
  }
}
