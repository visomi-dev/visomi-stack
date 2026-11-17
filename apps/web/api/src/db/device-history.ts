import { vaultSchema } from '@visomi-stack/backend-db';
import {
  deviceDeliveryLabel,
  deviceProofMessage,
  type DeviceDelivery,
  type DeviceProof,
  type KeyDomain,
} from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, sql } from 'drizzle-orm';

import type { ScopeAccess } from '../access/service';

import { publicHash } from './device-proof';

/** The current authorized signer explicitly grants every retained replay generation to this recipient. */
export async function requireHistory(
  context: ScopeAccess,
  key: KeyDomain,
  proof: DeviceProof,
  history: readonly DeviceDelivery[],
) {
  let previous = 0;

  for (const delivery of history) {
    const generation = delivery.binding.key.generation;
    const expected = {
      key: { ...key, generation },
      ownerId: proof.ownerId,
      deviceId: proof.deviceId,
      requestId: proof.requestId,
      challenge: proof.challenge,
      fingerprint: publicHash(deviceProofMessage(proof)),
      encryption: proof.keys.encryption,
    };

    if (
      generation <= previous ||
      generation >= key.generation ||
      deviceDeliveryLabel(delivery.binding) !== deviceDeliveryLabel(expected)
    ) {
      throw new HttpError(400, 'device_history_invalid');
    }

    previous = generation;
  }

  const events = vaultSchema.opaqueEvents;
  const required = await context.tx
    .selectDistinct({ generation: sql<number>`(${events.envelope}->'context'->'key'->>'generation')::integer` })
    .from(events)
    .where(
      and(
        eq(events.tenantId, context.target.tenantId),
        eq(events.scopeId, context.scope.id),
        eq(events.domain, key.domain),
      ),
    )
    .limit(66);

  if (
    required.some(
      ({ generation }) =>
        generation !== key.generation && !history.some((item) => item.binding.key.generation === generation),
    )
  ) {
    throw new HttpError(409, 'device_history_required');
  }
}
