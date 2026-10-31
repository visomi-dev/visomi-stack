import { createHash, randomUUID } from 'node:crypto';

import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { authSchema, DATABASE, inject, type Database } from '@visomi-stack/backend-shared';
import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { completeEnrollment } from '../recovery/service';
import { AUTH_CONFIG, type AuthConfig } from '../shared/config';
import { lastMethod, lockIdentity, principal } from '../shared/identity';
import { requireFresh } from '../shared/security';

const { challenges, credentials, sessions, users } = authSchema;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Purpose = typeof challenges.$inferSelect.purpose;
const hash = (challenge: string) => createHash('sha256').update(challenge).digest('hex');

export class Passkeys {
  private readonly database = inject<Database>(DATABASE);
  private readonly config = inject<AuthConfig>(AUTH_CONFIG);

  async registrationOptions(sid: string, user?: Express.User, email?: string) {
    if (user) {
      requireFresh(user, this.config);
    }

    const subjectId = user?.id ?? randomUUID();
    let existing: (typeof credentials.$inferSelect)[] = [];

    if (user) {
      const owned = await this.database
        .select()
        .from(credentials)
        .where(and(eq(credentials.userId, user.id), isNull(credentials.revokedAt)));

      existing = owned;
    }

    const options = await generateRegistrationOptions({
      rpName: 'Visomi Stack',
      rpID: this.config.rpId,
      userID: Buffer.from(subjectId),
      userName: subjectId,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: existing.map((item) => ({
        id: item.credentialId,
        transports: item.transports as AuthenticatorTransport[],
      })),
    });
    const challengeId = await this.challenge(sid, user ? 'enrollment' : 'signup', options.challenge, subjectId, email);

    return { challengeId, options };
  }

  async register(
    sid: string,
    challengeId: string,
    response: RegistrationResponseJSON,
    label: string,
    user?: Express.User,
  ) {
    const pending = await this.consume(sid, challengeId, user ? 'enrollment' : 'signup');

    if (user) {
      requireFresh(user, this.config);

      if (pending.subjectId !== user.id) {
        throw new HttpError(400, 'challenge_invalid');
      }
    }

    let verified;

    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: (value) => hash(value) === pending.challengeHash,
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        requireUserPresence: true,
        requireUserVerification: true,
      });

      verified = result;
    } catch {
      throw new HttpError(400, 'passkey_invalid');
    }

    if (!verified.verified) {
      throw new HttpError(400, 'passkey_invalid');
    }

    const info = verified.registrationInfo;
    const id = randomUUID();

    return this.database.transaction(async (tx) => {
      if (user) {
        await this.lockUser(tx, user, sid);
      }

      await this.lockSession(tx, sid);

      if (!user) {
        await tx.insert(users).values({ id: pending.subjectId!, email: pending.email });
      }

      await tx.insert(credentials).values({
        id,
        userId: pending.subjectId!,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        backupEligible: info.credentialDeviceType === 'multiDevice',
        backupState: info.credentialBackedUp,
        rpId: this.config.rpId,
        label,
        pendingGrantId: user?.grantId,
      });

      const [identity] = await tx.select().from(users).where(eq(users.id, pending.subjectId!));

      return {
        ...principal(identity, 'passkey', id, user?.grantId ? 'enrollment' : undefined),
        ...(user ? { authenticatedAt: user.authenticatedAt, secondFactor: user.secondFactor } : {}),
        ...(user?.grantId ? { grantId: user.grantId } : {}),
      };
    });
  }

  async authenticationOptions(sid: string) {
    const options = await generateAuthenticationOptions({ rpID: this.config.rpId, userVerification: 'required' });
    const challengeId = await this.challenge(sid, 'authentication', options.challenge);

    return { challengeId, options };
  }

  async authenticate(
    sid: string,
    challengeId: string,
    response: AuthenticationResponseJSON,
    enrollment?: Express.User,
  ) {
    const pending = await this.consume(sid, challengeId, 'authentication');

    const [candidate] = await this.database.select().from(credentials).where(eq(credentials.credentialId, response.id));

    if (
      !candidate ||
      (candidate.pendingGrantId &&
        (enrollment?.grantId !== candidate.pendingGrantId || enrollment.methodId !== candidate.id))
    ) {
      throw new HttpError(400, 'passkey_invalid');
    }

    return this.database.transaction(async (tx) => {
      const [identity] = await tx.select().from(users).where(eq(users.id, candidate.userId)).for('update');

      await this.lockSession(tx, sid);

      const [credential] = await tx
        .select()
        .from(credentials)
        .where(and(eq(credentials.credentialId, response.id), isNull(credentials.revokedAt)))
        .for('update');

      if (
        !credential ||
        credential.rpId !== this.config.rpId ||
        (response.response.userHandle &&
          response.response.userHandle !== Buffer.from(credential.userId).toString('base64url'))
      ) {
        throw new HttpError(400, 'passkey_invalid');
      }

      let verified;

      try {
        const result = await verifyAuthenticationResponse({
          response,
          credential: {
            id: credential.credentialId,
            publicKey: Buffer.from(credential.publicKey, 'base64url'),
            counter: credential.counter,
            transports: credential.transports as AuthenticatorTransport[],
          },
          expectedChallenge: (value) => hash(value) === pending.challengeHash,
          expectedOrigin: this.config.origin,
          expectedRPID: this.config.rpId,
          requireUserVerification: true,
        });

        verified = result;
      } catch {
        throw new HttpError(400, 'passkey_invalid');
      }

      if (
        !verified.verified ||
        (verified.authenticationInfo.credentialDeviceType === 'multiDevice') !== credential.backupEligible
      ) {
        throw new HttpError(400, 'passkey_invalid');
      }

      await tx
        .update(credentials)
        .set({
          counter: verified.authenticationInfo.newCounter,
          backupState: verified.authenticationInfo.credentialBackedUp,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(credentials.id, credential.id));

      if (credential.pendingGrantId) {
        const [grant] = await tx
          .select()
          .from(authSchema.flows)
          .where(
            and(
              eq(authSchema.flows.id, credential.pendingGrantId),
              eq(authSchema.flows.sessionId, sid),
              isNull(authSchema.flows.consumedAt),
              gt(authSchema.flows.expiresAt, new Date()),
            ),
          )
          .for('update');

        if (!grant) {
          throw new HttpError(400, 'challenge_invalid');
        }

        return completeEnrollment(tx, identity, grant, sid, 'passkey', credential.id);
      }

      return principal(identity, 'passkey', credential.id);
    });
  }

  async list(user: Express.User) {
    return this.database
      .select({
        id: credentials.id,
        label: credentials.label,
        createdAt: credentials.createdAt,
        lastUsedAt: credentials.lastUsedAt,
        backupEligible: credentials.backupEligible,
        backupState: credentials.backupState,
      })
      .from(credentials)
      .where(and(eq(credentials.userId, user.id), isNull(credentials.revokedAt), isNull(credentials.pendingGrantId)));
  }

  async rename(sid: string, user: Express.User, id: string, label: string) {
    requireFresh(user, this.config);

    await this.database.transaction(async (tx) => {
      await this.lockUser(tx, user, sid);

      await this.lockSession(tx, sid);

      const updated = await tx
        .update(credentials)
        .set({ label, updatedAt: new Date() })
        .where(and(eq(credentials.id, id), eq(credentials.userId, user.id), isNull(credentials.revokedAt)))
        .returning({ id: credentials.id });

      if (!updated.length) {
        throw new HttpError(404, 'credential_not_found');
      }
    });
  }

  async revoke(sid: string, user: Express.User, id: string) {
    requireFresh(user, this.config);

    await this.database.transaction(async (tx) => {
      await this.lockUser(tx, user, sid);

      await this.lockSession(tx, sid);

      const owned = await tx
        .select()
        .from(credentials)
        .where(and(eq(credentials.userId, user.id), isNull(credentials.revokedAt)));

      if (!owned.some((credential) => credential.id === id)) {
        throw new HttpError(404, 'credential_not_found');
      }

      const [identity] = await tx.select().from(users).where(eq(users.id, user.id));

      await lastMethod(tx, identity, 'passkey', id, Boolean(this.config.googleClientId));

      await tx.update(credentials).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(credentials.id, id));

      // Invalidate sessions authenticated with this credential, including a concurrently loaded snapshot.
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), expire: new Date(0), sess: {} })
        .where(
          and(
            sql`${sessions.sess}->'passport'->'user'->>'id' = ${user.id}`,
            sql`${sessions.sess}->'passport'->'user'->>'credentialId' = ${id}`,
          ),
        );
    });
  }

  private async lockUser(tx: Transaction, user: Express.User, sid: string) {
    await lockIdentity(tx, sid, user);
  }

  private async lockSession(tx: Transaction, sid: string) {
    const [active] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.sid, sid), isNull(sessions.revokedAt), gt(sessions.expire, new Date())))
      .for('update');

    if (!active) {
      throw new AuthHttpError(401, 'session_expired');
    }
  }

  private async challenge(sid: string, purpose: Purpose, value: string, subjectId?: string, email?: string) {
    const id = randomUUID();

    await this.database.transaction(async (tx) => {
      await this.lockSession(tx, sid);

      await tx.delete(challenges).where(eq(challenges.sessionId, sid));

      await tx.insert(challenges).values({
        id,
        sessionId: sid,
        purpose,
        subjectId,
        email,
        challengeHash: hash(value),
        expiresAt: new Date(Date.now() + this.config.challengeMaxAge),
      });
    });

    return id;
  }

  private async consume(sid: string, id: string, purpose: Purpose) {
    // Consumption commits before cryptographic verification: even a failed attempt cannot reuse it.
    return this.database.transaction(async (tx) => {
      await this.lockSession(tx, sid);

      const [pending] = await tx
        .delete(challenges)
        .where(
          and(
            eq(challenges.id, id),
            eq(challenges.sessionId, sid),
            eq(challenges.purpose, purpose),
            gt(challenges.expiresAt, new Date()),
          ),
        )
        .returning();

      if (!pending) {
        throw new HttpError(400, 'challenge_invalid');
      }

      return pending;
    });
  }
}
