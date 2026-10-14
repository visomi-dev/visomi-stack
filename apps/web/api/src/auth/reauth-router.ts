import { randomUUID } from 'node:crypto';

import { OAuth2Client } from 'google-auth-library';
import { Router } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { env } from '../shared/env';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import { authed, authedRequest, authenticationVerification } from './auth-middleware';
import { reauthStartSchema, reauthCompleteSchema } from './auth-schemas';
import { createOperationGrant } from './auth-service';
import { findUserById } from './auth-identity';
import { consumeRecoveryCode } from './auth-factors';
import { csrfProtection } from './passkey-security';
import { verifyPassword } from './password';
import { securityMethods } from './security-methods';
import { decryptTotpSecret, verifyTotpCode } from './totp';

import { authOperationGrants, db, HttpError, httpResponse, userFederatedIdentities, userTotpEnrollments } from 'shared';

export const reauthRouter = Router();

reauthRouter.post(
  '/reauth/start',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: reauthStartSchema }),
  async (req, res) => {
    const current = authedRequest(req).user;
    const { purpose } = getValidated<{ body: typeof reauthStartSchema }>(req).body!;
    const grantId = await createOperationGrant(current.id, purpose, req.sessionID);
    const available = await securityMethods(current.id, current.accountId);
    const [grant] = await db
      .select({ expiresAt: authOperationGrants.expiresAt })
      .from(authOperationGrants)
      .where(eq(authOperationGrants.id, grantId));

    req.session.reauthGrantId = grantId;
    const methods =
      purpose === 'passkey_enroll'
        ? available.methods.filter((method) => method === 'google' || method === 'passkey')
        : available.methods;
    const nonce = randomUUID();
    const session = req.session as typeof req.session & {
      reauthChallenge?: { grantId: string; purpose: string; methods: string[]; nonce: string };
    };

    session.reauthChallenge = { grantId, purpose, methods, nonce };
    delete req.session.passkeySecurityReauthenticatedAt;
    if (purpose === 'google_link') {
      req.session.googleNonce = randomUUID();
    }
    httpResponse.json(res, {
      data: {
        grantId,
        methods,
        ...(methods.includes('google') ? { google: { clientId: env.GOOGLE_AUTH_CLIENT_ID, nonce } } : {}),
        expiresAt: grant.expiresAt.toISOString(),
        passwordRequiresTotp: available.passwordEnabled && available.totpEnabled,
      },
      status: 201,
      message: 'Reauthentication started.',
    });
  },
);

reauthRouter.post(
  '/reauth/complete',
  csrfProtection,
  authed({ authority: 'full' }),
  validateRequest({ body: reauthCompleteSchema }),
  authenticationVerification('reauth'),
  async (req, res) => {
    const current = authedRequest(req).user;
    const body = getValidated<{ body: typeof reauthCompleteSchema }>(req).body!;
    const session = req.session as typeof req.session & {
      reauthChallenge?: { grantId: string; purpose: string; methods: string[]; nonce: string };
    };
    const challenge = session.reauthChallenge;
    const [operation] = await db
      .select()
      .from(authOperationGrants)
      .where(
        and(
          eq(authOperationGrants.id, body.grantId),
          eq(authOperationGrants.userId, current.id),
          eq(authOperationGrants.sessionBinding, req.sessionID),
          isNull(authOperationGrants.verifiedAt),
          isNull(authOperationGrants.consumedAt),
          gt(authOperationGrants.expiresAt, DateTime.utc().toJSDate()),
        ),
      )
      .limit(1);
    const available = await securityMethods(current.id, current.accountId);

    if (
      !operation ||
      !challenge ||
      challenge.grantId !== operation.id ||
      challenge.purpose !== operation.purpose ||
      !challenge.methods.includes(body.method) ||
      !available.methods.includes(body.method) ||
      (operation.purpose === 'passkey_enroll' && body.method !== 'google' && body.method !== 'passkey')
    ) {
      throw new HttpError({
        code: 'reauthentication_required',
        message: 'The reauthentication request is unavailable.',
        statusCode: 401,
      });
    }
    let valid = Boolean(
      req.session.passkeySecurityReauthenticatedAt &&
      DateTime.utc().toMillis() - req.session.passkeySecurityReauthenticatedAt <= 10 * 60_000 &&
      body.method === 'passkey',
    );
    const user = await findUserById(current.id);

    if (!user) {
      valid = false;
    }
    if (body.method === 'google' && body.idToken && env.GOOGLE_AUTH_CLIENT_ID) {
      try {
        const ticket = await new OAuth2Client(env.GOOGLE_AUTH_CLIENT_ID).verifyIdToken({
          idToken: body.idToken,
          audience: env.GOOGLE_AUTH_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        if (
          payload?.sub &&
          payload.iss === 'https://accounts.google.com' &&
          payload.email &&
          payload.email_verified === true &&
          payload.nonce === challenge.nonce
        ) {
          const [linked] = await db
            .select({ id: userFederatedIdentities.id })
            .from(userFederatedIdentities)
            .where(
              and(
                eq(userFederatedIdentities.userId, current.id),
                eq(userFederatedIdentities.provider, 'google'),
                eq(userFederatedIdentities.issuer, payload.iss),
                eq(userFederatedIdentities.subject, payload.sub),
                isNull(userFederatedIdentities.revokedAt),
              ),
            )
            .limit(1);

          valid = Boolean(linked);
        }
      } catch {
        valid = false;
      }
    }
    if (body.method === 'password' && body.password && user?.passwordHash) {
      const passwordValid = await verifyPassword(body.password, user.passwordHash);

      valid = passwordValid;
    }
    if (body.method === 'password' && user) {
      const [enrollment] = await db
        .select()
        .from(userTotpEnrollments)
        .where(and(eq(userTotpEnrollments.userId, current.id), eq(userTotpEnrollments.status, 'active')))
        .limit(1);

      if (enrollment) {
        valid = false;
        if (body.code) {
          const passwordValid = await verifyPassword(body.password ?? '', user.passwordHash ?? '');

          if (passwordValid) {
            const totpValid = await verifyTotpCode(
              decryptTotpSecret(enrollment.encryptedSecret, enrollment.keyVersion),
              body.code,
            );

            valid = totpValid;
          }
        }
      }
    }
    if (body.method === 'totp' && body.code) {
      const [enrollment] = await db
        .select()
        .from(userTotpEnrollments)
        .where(and(eq(userTotpEnrollments.userId, current.id), eq(userTotpEnrollments.status, 'active')))
        .limit(1);

      if (enrollment) {
        const totpValid = await verifyTotpCode(
          decryptTotpSecret(enrollment.encryptedSecret, enrollment.keyVersion),
          body.code,
        );

        valid = totpValid;
      }
    }
    if (body.method === 'recovery_code' && body.code) {
      const recoveryValid = await consumeRecoveryCode(current.id, body.code);

      valid = recoveryValid;
    }
    if (!valid) {
      throw new HttpError({
        code: 'reauthentication_failed',
        message: 'Reauthentication could not be completed.',
        statusCode: 401,
      });
    }
    const [grant] = await db
      .update(authOperationGrants)
      .set({ verifiedAt: DateTime.utc().toJSDate() })
      .where(
        and(
          eq(authOperationGrants.id, body.grantId),
          eq(authOperationGrants.userId, current.id),
          eq(authOperationGrants.sessionBinding, req.sessionID),
          isNull(authOperationGrants.verifiedAt),
          isNull(authOperationGrants.consumedAt),
          gt(authOperationGrants.expiresAt, DateTime.utc().toJSDate()),
        ),
      )
      .returning();

    if (!grant) {
      throw new HttpError({
        code: 'reauthentication_required',
        message: 'The reauthentication request is unavailable.',
        statusCode: 401,
      });
    }
    delete session.reauthChallenge;
    httpResponse.json(res, {
      data: { grantId: body.grantId, authenticated: true },
      message: 'Reauthentication completed.',
    });
  },
);
