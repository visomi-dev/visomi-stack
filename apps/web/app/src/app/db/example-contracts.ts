import { z } from 'zod';
import {
  keyDomainSchema,
  dataAad,
  VaultError,
  syntheticHybridPolicy,
  type KeyDomain,
  type WrappingContext,
  type DataEnvelope,
} from '@visomi-stack/shared-db';

export const rosterSchema = z.object({
  key: keyDomainSchema,
  epoch: z.number().int().positive(),
  phase: z.enum(['ready', 'rotating']),
  devices: z.array(
    z.object({
      id: z.uuid(),
      ownerId: z.uuid(),
      signing: z.string(),
      encryption: z.string(),
      revokedAt: z.string().nullable(),
    }),
  ),
});

export function validateExampleEnvelope(binding: WrappingContext | undefined, envelope: DataEnvelope): void {
  if (envelope.context.schemaVersion !== 1 || !['record', 'tombstone'].includes(envelope.context.kind)) {
    throw new VaultError('unsupported-version');
  }

  if (
    !binding ||
    envelope.context.key.generation > binding.key.generation ||
    dataAad({
      ...envelope.context,
      key: { ...binding.key, generation: envelope.context.key.generation },
      target: binding.key.scope,
    }) !== dataAad(envelope.context)
  ) {
    throw new VaultError('corrupt');
  }
}

export function exampleLocalKey(target: { tenantId: string; scopeId: string }): Omit<KeyDomain, 'generation'> {
  return {
    product: syntheticHybridPolicy.product,
    domain: 'private-resources',
    scope: { kind: 'resource', tenantId: target.tenantId, groupId: null, resourceId: target.scopeId },
  };
}
