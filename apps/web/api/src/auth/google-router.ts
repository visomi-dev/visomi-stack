import { randomUUID } from 'node:crypto';

import { OAuth2Client } from 'google-auth-library';
import { Router } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { env } from '../shared/env';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { authed, authedRequest } from './auth-middleware';
import { identityFlow, requestContext } from './auth-route-session';
import { googleCompleteSchema, googleLinkSchema } from './auth-schemas';
import { findUserByEmail, findUserById, normalizeEmail, resolveAuthUserForAccount } from './auth-identity';
import { establishFullSession } from './auth-session';
import { csrfProtection } from './passkey-security';

import {
  authAuditEvents,
  authIdentityFlows,
  db,
  HttpError,
  httpResponse,
  userFederatedIdentities,
  users,
} from 'shared';

export const googleRouter = Router();

googleRouter.post(
  '/google/link',
  csrfProtection,
  validateRequest({ body: googleLinkSchema }),
  authed({ authority: 'full', operation: { purpose: 'google_link', grantSource: 'body' } }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof googleLinkSchema }>(req).body!;

    if (!env.GOOGLE_AUTH_CLIENT_ID || !req.session.googleNonce) {
      throw new HttpError({ code: 'google_disabled', message: 'Google linking is not configured.', statusCode: 404 });
    }
    let payload;

    try {
      const ticket = await new OAuth2Client(env.GOOGLE_AUTH_CLIENT_ID).verifyIdToken({
        idToken: body.idToken,
        audience: env.GOOGLE_AUTH_CLIENT_ID,
      });

      payload = ticket.getPayload();
    } catch {
      throw new HttpError({
        code: 'google_token_invalid',
        message: 'Google identity could not be verified.',
        statusCode: 401,
      });
    }
    if (
      !payload?.sub ||
      payload.iss !== 'https://accounts.google.com' ||
      payload.nonce !== req.session.googleNonce ||
      !payload.email ||
      payload.email_verified !== true ||
      normalizeEmail(payload.email) !== normalizeEmail(current.email)
    ) {
      throw new HttpError({
        code: 'google_token_invalid',
        message: 'Google identity could not be verified.',
        statusCode: 401,
      });
    }
    const [existing] = await db
      .select()
      .from(userFederatedIdentities)
      .where(and(eq(userFederatedIdentities.issuer, payload.iss), eq(userFederatedIdentities.subject, payload.sub)))
      .limit(1);

    if (existing && existing.userId !== current.id) {
      throw new HttpError({
        code: 'google_identity_in_use',
        message: 'This Google identity is already linked.',
        statusCode: 409,
      });
    }
    if (existing) {
      await db
        .update(userFederatedIdentities)
        .set({ revokedAt: null, emailAtLink: normalizeEmail(payload.email), lastUsedAt: DateTime.utc().toJSDate() })
        .where(eq(userFederatedIdentities.id, existing.id));
    } else {
      await db.insert(userFederatedIdentities).values({
        id: randomUUID(),
        provider: 'google',
        issuer: payload.iss,
        subject: payload.sub,
        userId: current.id,
        emailAtLink: normalizeEmail(payload.email),
      });
    }
    delete req.session.googleNonce;
    httpResponse.json(res, { data: { linked: true }, message: 'Google identity linked.' });
  },
);

googleRouter.post(
  '/google/complete',
  csrfProtection,
  validateRequest({ body: googleCompleteSchema }),
  async (req, res) => {
    const body = getValidated<{ body: typeof googleCompleteSchema }>(req).body!;
    const flow = await identityFlow(req, body.flowId);

    if (!env.GOOGLE_AUTH_CLIENT_ID || req.session.googleNonce === undefined) {
      throw new HttpError({ code: 'google_disabled', message: 'Google sign-in is not configured.', statusCode: 404 });
    }
    const client = new OAuth2Client(env.GOOGLE_AUTH_CLIENT_ID);
    let payload;

    try {
      const ticket = await client.verifyIdToken({ idToken: body.idToken, audience: env.GOOGLE_AUTH_CLIENT_ID });

      payload = ticket.getPayload();
    } catch {
      await db.insert(authAuditEvents).values({
        id: randomUUID(),
        event: 'google_authentication',
        outcome: 'rejected',
        userId: null,
        accountId: null,
        contextHash: requestContext(req),
        createdAt: DateTime.utc().toJSDate(),
      });
      throw new HttpError({
        code: 'google_token_invalid',
        message: 'Google sign-in could not be verified.',
        statusCode: 401,
      });
    }
    if (
      !payload?.sub ||
      payload.iss !== 'https://accounts.google.com' ||
      payload.nonce !== req.session.googleNonce ||
      !payload.email ||
      payload.email_verified !== true
    ) {
      throw new HttpError({
        code: 'google_token_invalid',
        message: 'Google sign-in could not be verified.',
        statusCode: 401,
      });
    }
    const [linked] = await db
      .select()
      .from(userFederatedIdentities)
      .where(
        and(
          eq(userFederatedIdentities.issuer, payload.iss),
          eq(userFederatedIdentities.subject, payload.sub),
          isNull(userFederatedIdentities.revokedAt),
        ),
      )
      .limit(1);
    let user: Awaited<ReturnType<typeof findUserById>> | undefined = undefined;

    if (linked) {
      const linkedUser = await findUserById(linked.userId);

      user = linkedUser;
    } else {
      const existingEmailOwner = await findUserByEmail(payload.email);

      if (existingEmailOwner) {
        throw new HttpError({
          code: 'google_link_required',
          message: 'This Google account must be explicitly linked from an authenticated session.',
          statusCode: 409,
        });
      }
    }
    if (!linked) {
      const email = normalizeEmail(payload.email);
      const issuer = payload.iss;
      const subject = payload.sub;

      const createdUser = await db.transaction(async (tx) => {
        const now = DateTime.utc().toJSDate();
        // Only this insert may verify the primary email. Never adopt a concurrent email match.
        const [created] = await tx
          .insert(users)
          .values({ id: randomUUID(), email, emailVerifiedAt: now, createdAt: now, updatedAt: now })
          .onConflictDoNothing({ target: users.email })
          .returning();

        if (!created) {
          throw new HttpError({
            code: 'google_link_required',
            message: 'This Google account must be explicitly linked from an authenticated session.',
            statusCode: 409,
          });
        }
        const accountId = randomUUID();
        const name = email.split('@')[0];
        const baseSlug = name
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 80);

        // Keep account, membership and identity creation in the same transaction as verified email ownership.
        await tx.execute(sql`
        with inserted as (
          insert into accounts (id, name, slug, owner_user_id)
          values (${accountId}, ${name}, ${baseSlug}, ${created.id})
          on conflict (slug) do nothing
          returning id
        )
        insert into accounts (id, name, slug, owner_user_id)
        select ${accountId}, ${name}, ${`${baseSlug}-${accountId.slice(0, 8)}`}, ${created.id}
        where not exists (select 1 from inserted)
      `);
        await tx.execute(sql`
        insert into account_memberships (id, account_id, user_id, role)
        values (${randomUUID()}, ${accountId}, ${created.id}, 'owner')
      `);
        const [identity] = await tx
          .insert(userFederatedIdentities)
          .values({ id: randomUUID(), provider: 'google', issuer, subject, userId: created.id, emailAtLink: email })
          .onConflictDoNothing()
          .returning();

        if (!identity) {
          throw new HttpError({
            code: 'google_link_required',
            message: 'This Google account must be explicitly linked from an authenticated session.',
            statusCode: 409,
          });
        }

        return created;
      });

      user = createdUser;
    }
    if (!user) {
      throw new HttpError({
        code: 'google_token_invalid',
        message: 'Google sign-in could not be verified.',
        statusCode: 401,
      });
    }
    const membership = await resolveAuthUserForAccount(user);
    const authUser = {
      ...membership,
      authority: 'full' as const,
      authenticationMethod: 'google' as const,
      authVersion: user.authVersion,
    };

    if (linked) {
      await db
        .update(userFederatedIdentities)
        .set({ lastUsedAt: DateTime.utc().toJSDate() })
        .where(eq(userFederatedIdentities.id, linked.id));
    }
    await db
      .update(authIdentityFlows)
      .set({
        state: 'complete',
        authorizationMethod: 'google',
        userId: user.id,
        accountId: membership.accountId,
        completedAt: DateTime.utc().toJSDate(),
        updatedAt: DateTime.utc().toJSDate(),
      })
      .where(eq(authIdentityFlows.id, flow.id));
    await establishFullSession(req, res, authUser);
    delete req.session.googleNonce;
    httpResponse.json(res, {
      data: { authenticated: true, user: authUser },
      message: 'Google authentication complete.',
    });
  },
);
