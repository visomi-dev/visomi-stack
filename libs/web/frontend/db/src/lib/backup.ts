import {
  dataAad,
  keyDomainId,
  vaultUnitId,
  vaultBackupSchema,
  wrappingAad,
  VaultError,
  type DataContext,
  type VaultStorage,
  type WrappingContext,
} from '@visomi-stack/shared-db';

/** Bounded encrypted export batches, not an eager decrypt/load of an entire vault. */
export async function exportEncryptedBackup(
  storage: VaultStorage,
  binding: WrappingContext,
  contexts: readonly DataContext[],
): Promise<string> {
  if (contexts.length > 100) {
    throw new VaultError('quota');
  }

  const key = await storage.getKey(keyDomainId(binding.ownerId, binding.key));

  if (!key || wrappingAad(key.context) !== wrappingAad(binding)) {
    throw new VaultError('recovery-required');
  }

  const units = [];
  let bytes = 0;

  for (const context of contexts) {
    const envelope = await storage.getUnit(vaultUnitId(binding.ownerId, context));

    if (!envelope || dataAad(context) !== dataAad(envelope.context)) {
      throw new VaultError('corrupt');
    }

    bytes += envelope.ciphertext.length;

    if (bytes > 15_000_000) {
      throw new VaultError('quota');
    }

    units.push(envelope);
  }
  const result = vaultBackupSchema.safeParse({ format: 'visomi.vault-backup', version: 1, key, units });

  if (!result.success) {
    throw new VaultError('corrupt');
  }

  const serialized = JSON.stringify(result.data);

  if (serialized.length > 16_777_216) {
    throw new VaultError('quota');
  }

  return serialized;
}

/** Import stays locked. A current trusted generation floor must come from the consumer's registry/pins. */
export async function restoreEncryptedBackup(
  storage: VaultStorage,
  expected: WrappingContext,
  minimumGeneration: number,
  serialized: string,
): Promise<void> {
  if (serialized.length > 16_777_216) {
    throw new VaultError('quota');
  }

  let raw: unknown;

  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new VaultError('corrupt');
  }
  const parsed = vaultBackupSchema.safeParse(raw);

  if (
    !parsed.success ||
    !Number.isInteger(minimumGeneration) ||
    minimumGeneration < 1 ||
    expected.key.generation < minimumGeneration ||
    wrappingAad(parsed.data.key.context) !== wrappingAad(expected)
  ) {
    throw new VaultError('corrupt');
  }

  await storage.restore(
    { id: keyDomainId(expected.ownerId, expected.key), envelope: parsed.data.key },
    parsed.data.units.map((envelope) => ({ id: vaultUnitId(expected.ownerId, envelope.context), envelope })),
  );
}
