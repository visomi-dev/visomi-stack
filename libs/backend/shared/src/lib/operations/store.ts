import { createHash, createHmac, randomUUID } from 'node:crypto';

import { and, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { withAccountContext } from '../db/account-context';
import { db } from '../db/client';
import { accountMemberships, durableOperations, notificationInbox, users } from '../db/schema';
import { env } from '../env';
import { HttpError } from '../http';
import { publishNotificationHint } from '../notifications/events';
import { enqueueNotificationPush } from '../notifications/queue';
import { publishJson } from '../redis/pub-sub';

import { operationChannel, operationEvent } from './contract';
import type { OperationEvent, OperationOwner } from './contract';

export type DurableOperation = typeof durableOperations.$inferSelect;
export type OperationDb = Parameters<Parameters<typeof withAccountContext>[1]>[0];

export function operationOwnerKey(owner: OperationOwner): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(JSON.stringify(['operation-v1', owner.sessionId, owner.userId, owner.accountId, owner.authVersion]))
    .digest('hex');
}

/** A producer must insert its feature record in this transaction before returning HTTP 202. */
export async function acceptDurableOperation(
  owner: OperationOwner,
  input: { requestKey: string; kind: string; fingerprint: string },
  prepare: (db: OperationDb, operationId: string) => Promise<unknown>,
): Promise<DurableOperation> {
  return withAccountContext(owner, async (transaction) => {
    const id = randomUUID();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([input.kind, input.fingerprint]))
      .digest('hex');
    const [inserted] = await transaction
      .insert(durableOperations)
      .values({
        id,
        owner: operationOwnerKey(owner),
        requestKey: input.requestKey,
        fingerprint,
        sessionId: owner.sessionId,
        userId: owner.userId,
        accountId: owner.accountId,
        authVersion: owner.authVersion,
        kind: input.kind,
        payload: {},
        expiresAt: DateTime.utc().plus({ minutes: 10 }).toJSDate(),
      })
      .onConflictDoNothing()
      .returning();

    if (!inserted) {
      const [existing] = await transaction
        .select()
        .from(durableOperations)
        .where(
          and(
            eq(durableOperations.owner, operationOwnerKey(owner)),
            eq(durableOperations.accountId, owner.accountId),
            eq(durableOperations.requestKey, input.requestKey),
          ),
        );

      if (!existing || existing.fingerprint !== fingerprint || existing.expiresAt.getTime() <= Date.now()) {
        throw new HttpError({
          code: 'operation_request_conflict',
          message: 'Use a new request key for this operation.',
          statusCode: 409,
        });
      }

      return existing;
    }

    const payload = await prepare(transaction, id);
    const [prepared] = await transaction
      .update(durableOperations)
      .set({ payload })
      .where(eq(durableOperations.id, id))
      .returning();

    return prepared;
  });
}

export async function hasOperationMembership(owner: OperationOwner): Promise<boolean> {
  const [member] = await db
    .select({ authVersion: users.authVersion })
    .from(accountMemberships)
    .innerJoin(users, eq(users.id, accountMemberships.userId))
    .where(and(eq(accountMemberships.accountId, owner.accountId), eq(accountMemberships.userId, owner.userId)));

  return member?.authVersion === owner.authVersion;
}

export async function readOperation(operationId: string, owner: OperationOwner): Promise<OperationEvent | null> {
  if (!(await hasOperationMembership(owner))) return null;

  return withAccountContext(owner, async (transaction) => {
    const [operation] = await transaction
      .select()
      .from(durableOperations)
      .where(
        and(
          eq(durableOperations.id, operationId),
          eq(durableOperations.accountId, owner.accountId),
          eq(durableOperations.owner, operationOwnerKey(owner)),
          gt(durableOperations.expiresAt, new Date()),
        ),
      );

    if (!operation) return null;

    return operationEvent.parse({
      operationId: operation.id,
      status: operation.status,
      ...(operation.status === 'completed' && operation.result ? { result: operation.result } : {}),
      ...(operation.status === 'failed' && operation.error ? { error: operation.error } : {}),
    });
  });
}

/** Worker discovery requires the infrastructure role; consumers never receive this query's rows. */
export async function claimDurableOperation(kinds: string[]): Promise<DurableOperation | null> {
  const now = new Date();
  const [candidate] = await db
    .select()
    .from(durableOperations)
    .where(
      and(
        inArray(durableOperations.kind, kinds),
        inArray(durableOperations.status, ['pending', 'running']),
        lte(durableOperations.availableAt, now),
        gt(durableOperations.expiresAt, now),
        lt(durableOperations.attempts, 3),
      ),
    )
    .orderBy(durableOperations.createdAt)
    .limit(1);

  if (!candidate) return null;
  const [claimed] = await db
    .update(durableOperations)
    .set({
      status: 'running',
      attempts: sql`${durableOperations.attempts} + 1`,
      lease: randomUUID(),
      availableAt: DateTime.utc().plus({ minutes: 1 }).toJSDate(),
    })
    .where(
      and(
        eq(durableOperations.id, candidate.id),
        eq(durableOperations.attempts, candidate.attempts),
        inArray(durableOperations.status, ['pending', 'running']),
        lte(durableOperations.availableAt, now),
      ),
    )
    .returning();

  return claimed ?? null;
}

export async function finishDurableOperation(operation: DurableOperation, event: OperationEvent): Promise<boolean> {
  const parsed = operationEvent.parse(event);

  if (parsed.operationId !== operation.id || !['completed', 'failed'].includes(parsed.status) || !operation.lease) {
    throw new Error('Invalid operation completion.');
  }
  const lease = operation.lease;
  const finished = await withAccountContext(operation, async (transaction) => {
    const [updated] = await transaction
      .update(durableOperations)
      .set({
        status: parsed.status,
        result: parsed.result ?? null,
        error: parsed.error ?? null,
        lease: null,
      })
      .where(
        and(
          eq(durableOperations.id, operation.id),
          eq(durableOperations.accountId, operation.accountId),
          eq(durableOperations.status, 'running'),
          eq(durableOperations.lease, lease),
        ),
      )
      .returning();

    if (updated && parsed.status === 'completed') {
      const [membership] = await transaction
        .select({ id: accountMemberships.id })
        .from(accountMemberships)
        .where(
          and(eq(accountMemberships.accountId, operation.accountId), eq(accountMemberships.userId, operation.userId)),
        );

      if (membership) {
        const [notification] = await transaction
          .insert(notificationInbox)
          .values({
            id: operation.id,
            accountId: operation.accountId,
            userId: operation.userId,
            kind: 'service',
          })
          .onConflictDoNothing()
          .returning();

        if (notification) await enqueueNotificationPush(transaction, operation, operation.id);
      }
    }

    return updated;
  });

  if (!finished) return false;
  // Persistence is authoritative. Redis outages cannot turn a committed completion into a failed operation.
  await publishJson(operationChannel, { operationId: operation.id }).catch(() => undefined);
  if (parsed.status === 'completed') {
    await publishNotificationHint({ accountId: operation.accountId, userId: operation.userId });
  }

  return true;
}

export async function expireDurableOperations(): Promise<void> {
  await db
    .update(durableOperations)
    .set({ status: 'failed', lease: null, error: { code: 'operation_expired', status: 410 } })
    .where(
      and(inArray(durableOperations.status, ['pending', 'running']), lte(durableOperations.expiresAt, new Date())),
    );
  await db
    .update(durableOperations)
    .set({ status: 'failed', lease: null, error: { code: 'operation_attempts_exhausted', status: 503 } })
    .where(
      and(
        eq(durableOperations.status, 'running'),
        eq(durableOperations.attempts, 3),
        lte(durableOperations.availableAt, new Date()),
      ),
    );
  await db
    .delete(durableOperations)
    .where(lt(durableOperations.expiresAt, DateTime.utc().minus({ days: 1 }).toJSDate()));
}
