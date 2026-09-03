import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { Router } from 'express';

import { clearMailbox, listSentMessages } from '../auth/auth-mail';
import {
  consumeChallenge,
  createChallenge,
  findOrCreateUserByEmail,
  findUserById,
  listMembershipsForUser,
  markChallengeConsumed,
  resolveAuthUser,
} from '../auth/auth-service';
import { emailSchema, getValidated, validateRequest, z } from '../shared/http/route-schemas';

import { accountMemberships, db } from 'shared';

const mailboxQuerySchema = z
  .object({
    email: emailSchema.optional(),
    purpose: z.enum(['bootstrap_recovery']).optional(),
  })
  .meta({ id: 'TestMailboxQuery' });

const mailboxMessageSchema = z
  .object({
    challengeId: z.string(),
    email: emailSchema,
    expiresAt: z.string(),
    pin: z.string(),
    purpose: z.literal('bootstrap_recovery'),
  })
  .meta({ id: 'MailboxMessage' });

const deterministicSessionSchema = z
  .object({ email: emailSchema, accountId: z.string().min(1).optional() })
  .meta({ id: 'DeterministicTestSession' });

const testOpenApiPaths = {
  '/test/mailbox/latest': {
    get: {
      requestParams: { query: mailboxQuerySchema },
      responses: {
        200: {
          content: { 'application/json': { schema: mailboxMessageSchema } },
          description: 'Latest mailbox message.',
        },
      },
    },
  },
  '/test/mailbox': {
    delete: {
      responses: { 204: { description: 'Mailbox cleared.' } },
    },
  },
};

const testRouter = Router();

testRouter.post(
  '/auth/session',
  validateRequest({ body: deterministicSessionSchema }),
  async function deterministicSessionHandler(req, res, next) {
    try {
      const { email, accountId } = getValidated<{ body: typeof deterministicSessionSchema }>(req).body!;
      const user = await findOrCreateUserByEmail(email);
      const challenge = await createChallenge(user, 'bootstrap_recovery');
      const message = listSentMessages().find((candidate) => candidate.challengeId === challenge.challengeId);

      if (!message) {
        res.status(503).send({ error: 'deterministic_auth_unavailable' });

        return;
      }

      await consumeChallenge(challenge.challengeId, message.pin);
      await markChallengeConsumed(challenge.challengeId);
      await listMembershipsForUser(user.id);

      if (accountId) {
        await db.delete(accountMemberships).where(eq(accountMemberships.userId, user.id));
        await db.insert(accountMemberships).values({
          accountId,
          createdAt: new Date(),
          id: randomUUID(),
          role: 'member',
          updatedAt: new Date(),
          userId: user.id,
        });
      }

      const freshUser = await findUserById(user.id);

      if (!freshUser) {
        res.status(503).send({ error: 'deterministic_auth_unavailable' });

        return;
      }

      const authUser = await resolveAuthUser(freshUser);

      await new Promise<void>((resolve, reject) => {
        req.login({ ...authUser, authority: 'full' }, (error) => (error ? reject(error) : resolve()));
      });
      req.session.authority = 'full';

      await new Promise<void>((resolve, reject) => {
        req.session.save((error) => (error ? reject(error) : resolve()));
      });

      res.status(200).send({ data: { accountId: authUser.accountId, userId: authUser.id } });
    } catch (error: unknown) {
      next(error);
    }
  },
);

testRouter.get(
  '/mailbox/latest',
  validateRequest({ query: mailboxQuerySchema }),
  function mailboxLatestHandler(req, res) {
    const { email, purpose } = getValidated<{ query: typeof mailboxQuerySchema }>(req).query!;

    const messages = listSentMessages();

    const matchingMessages = messages.filter(
      (message) => (!email || message.email === email) && (!purpose || message.purpose === purpose),
    );

    const match = matchingMessages[matchingMessages.length - 1];

    if (!match) {
      res.status(404).send({ error: 'mail_not_found' });

      return;
    }

    res.send(match);
  },
);

testRouter.delete('/mailbox', function clearMailboxHandler(_req, res) {
  clearMailbox();
  res.status(204).send();
});

export { testOpenApiPaths, testRouter };
