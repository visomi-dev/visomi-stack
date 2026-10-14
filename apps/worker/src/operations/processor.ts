import { z } from 'zod';

import { parseProjectJob, processObservedProjectJob } from '../projects/project-seed/processor';

import {
  claimDurableOperation,
  createSessionStore,
  env,
  expireDurableOperations,
  finishDurableOperation,
  getPool,
  hasOperationMembership,
  isSessionAuthorityStore,
  logger,
  revokeSessionPushSubscriptions,
  expirePushSubscriptions,
} from 'shared';
import type { DurableOperation, OperationOwner } from 'shared';
import { failProjectSeedJob, findAsyncJobById, getProject } from 'projects';

function ownerOf(operation: DurableOperation): OperationOwner {
  return {
    sessionId: operation.sessionId,
    userId: operation.userId,
    accountId: operation.accountId,
    authVersion: operation.authVersion,
  };
}

const sessionScope = z.object({ passport: z.object({ user: z.object({ accountId: z.uuid() }) }) });

/** Existing seed handlers are idempotent and bounded; no finance or inference runners are registered. */
export async function processNextOperation(): Promise<boolean> {
  await expireDurableOperations();
  await expirePushSubscriptions();
  const operation = await claimDurableOperation(['project_seed']);

  if (!operation) return false;
  const owner = ownerOf(operation);
  let completed = false;
  const store = createSessionStore(
    {
      cookieSecure: env.COOKIE_SECURE,
      databaseDriver: env.DATABASE_DRIVER,
      sessionMaxAgeMs: env.SESSION_MAX_AGE_MS,
      sessionSecret: env.SESSION_SECRET,
      onSessionRevoked: revokeSessionPushSubscriptions,
    },
    env.DATABASE_DRIVER === 'pg' ? getPool() : undefined,
  );

  try {
    if (!isSessionAuthorityStore(store)) throw new Error('Operation authority is unavailable.');
    await store.withSessionAuthority(
      {
        userId: owner.userId,
        authVersion: owner.authVersion,
        currentSid: owner.sessionId,
        authority: 'full',
      },
      async () => {
        const current = await new Promise<unknown>((resolve, reject) =>
          store.get(owner.sessionId, (error, value) => (error ? reject(error) : resolve(value))),
        );

        if (sessionScope.parse(current).passport.user.accountId !== owner.accountId)
          throw new Error('Operation account changed.');
        if (!(await hasOperationMembership(owner))) throw new Error('Operation membership was revoked.');
        const payload = parseProjectJob(operation.payload);

        if (
          payload.accountId !== owner.accountId ||
          payload.userId !== owner.userId ||
          payload.jobId !== operation.id
        ) {
          throw new Error('Operation routing does not match its owner.');
        }
        if (!(await getProject(owner, payload.projectId))) throw new Error('Operation project was removed.');
        const job = await findAsyncJobById(owner, payload.jobId);

        if (!job || job.status === 'failed') throw new Error('Operation job is unavailable.');
        if (job.status !== 'completed') await processObservedProjectJob(payload);
        completed = true;
        await finishDurableOperation(operation, {
          operationId: operation.id,
          status: 'completed',
          result: { jobId: payload.jobId },
        });
      },
    );
  } catch {
    // Recover a successful feature write instead of converting a transient
    // result-storage failure into a permanent operation failure.
    if (completed) throw new Error('Operation completion storage is unavailable.');
    const job = await findAsyncJobById(owner, operation.id);

    if (job?.projectId && !['completed', 'failed'].includes(job.status)) {
      // System-owned status cleanup, not execution of revoked tenant work.
      await failProjectSeedJob(
        {
          data: {
            accountId: owner.accountId,
            userId: owner.userId,
            jobId: operation.id,
            projectId: job.projectId,
          },
        },
        new Error('Operation unavailable.'),
      );
    }
    // Do not persist provider errors, session identifiers or private job input in public results.
    await finishDurableOperation(operation, {
      operationId: operation.id,
      status: 'failed',
      error: { code: 'operation_unavailable', status: 409 },
    });
    logger.warn({ operationId: operation.id }, 'Durable operation could not be completed');
  }

  return true;
}
