import { z } from 'zod';

import { dataEnvelopeSchema, wrappedKeySchema } from './crypto-contract';
import { keyDomainId, vaultUnitId } from './vault-contract';

export const vaultBackupSchema = z
  .strictObject({
    format: z.literal('visomi.vault-backup'),
    version: z.literal(1),
    key: wrappedKeySchema,
    units: z.array(dataEnvelopeSchema).max(100),
  })
  .superRefine((value, context) => {
    const domain = keyDomainId(value.key.context.ownerId, value.key.context.key);
    const ids = value.units.map((envelope) => vaultUnitId(value.key.context.ownerId, envelope.context));

    if (
      new Set(ids).size !== ids.length ||
      value.units.some((envelope) => keyDomainId(value.key.context.ownerId, envelope.context.key) !== domain)
    ) {
      context.addIssue({ code: 'custom', message: 'vault_backup_invalid' });
    }
  });
export type VaultBackup = z.infer<typeof vaultBackupSchema>;
