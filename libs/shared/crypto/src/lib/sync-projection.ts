import { z } from 'zod';

import type { ProjectionChange } from './client-sync';
import { parseEncryptedEnvelope } from './encrypted-envelope';
import type { EncryptedEnvelope } from './encrypted-envelope';
import { decodeVaultBytes, encodeVaultBytes } from './vault-key-envelope';

const changeSchema = z.strictObject({
  entityId: z.string().min(1).max(256),
  entityType: z.enum(['work', 'planning', 'progress']),
  operation: z.enum(['upsert', 'delete']),
  revision: z.number().int().positive(),
  actorId: z.string().min(1).max(256),
  envelopeId: z.string().min(1).max(256),
  value: z.record(z.string().max(256), z.union([z.string().max(10_000), z.number().finite()])).optional(),
});

export type ProjectionScope = { ownerUserId: string; accountId: string; workspaceId: string };
const encoder = new TextEncoder();

/** Authenticate every ordering/routing field, not just user-defined associated data. */
function aad(envelope: Omit<EncryptedEnvelope, 'nonce' | 'ciphertext' | 'authTag'>): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify([
      'visomi-sync-projection-v1',
      envelope.format,
      envelope.version,
      envelope.kind,
      envelope.envelopeId,
      envelope.workspaceId,
      envelope.recordType,
      envelope.revision,
      envelope.createdAt,
      Object.entries(envelope.associatedData).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      Object.entries(envelope.metadata).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ]),
  );
}

export async function sealSyncProjection(
  crypto: Crypto,
  key: CryptoKey,
  scope: ProjectionScope,
  input: ProjectionChange,
  createdAt: string,
): Promise<EncryptedEnvelope> {
  const change = changeSchema.parse(input);
  const header = {
    format: 'themis.encrypted-envelope' as const,
    version: 1 as const,
    kind: 'sync-object' as const,
    envelopeId: change.envelopeId,
    workspaceId: scope.workspaceId,
    recordType: 'projection',
    revision: change.revision,
    createdAt,
    associatedData: { ownerUserId: scope.ownerUserId, accountId: scope.accountId },
    metadata: { contentType: 'application/json', tombstone: String(change.operation === 'delete') },
  };
  const bytes = encoder.encode(JSON.stringify(change));
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  try {
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad(header), tagLength: 128 },
        key,
        bytes,
      ),
    );

    return parseEncryptedEnvelope({
      ...header,
      nonce: encodeVaultBytes(nonce),
      ciphertext: encodeVaultBytes(encrypted.slice(0, -16)),
      authTag: encodeVaultBytes(encrypted.slice(-16)),
    });
  } finally {
    bytes.fill(0);
  }
}

export async function openSyncProjection(
  crypto: Crypto,
  key: CryptoKey,
  scope: ProjectionScope,
  input: EncryptedEnvelope,
): Promise<ProjectionChange> {
  const envelope = parseEncryptedEnvelope(input);

  if (
    envelope.kind !== 'sync-object' ||
    envelope.recordType !== 'projection' ||
    envelope.workspaceId !== scope.workspaceId ||
    envelope.associatedData['ownerUserId'] !== scope.ownerUserId ||
    envelope.associatedData['accountId'] !== scope.accountId
  )
    throw new Error('sync_projection_scope_mismatch');
  const ciphertext = decodeVaultBytes(envelope.ciphertext, Math.floor((envelope.ciphertext.length * 3) / 4));
  const tag = decodeVaultBytes(envelope.authTag, 16);
  const combined = new Uint8Array(ciphertext.length + tag.length);

  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  const bytes = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeVaultBytes(envelope.nonce, 12), additionalData: aad(envelope), tagLength: 128 },
      key,
      combined,
    ),
  );

  try {
    const change = changeSchema.parse(JSON.parse(new TextDecoder().decode(bytes)) as unknown);

    if (
      change.envelopeId !== envelope.envelopeId ||
      change.revision !== envelope.revision ||
      String(change.operation === 'delete') !== envelope.metadata['tombstone']
    )
      throw new Error('sync_projection_mismatch');

    return change;
  } finally {
    bytes.fill(0);
  }
}
