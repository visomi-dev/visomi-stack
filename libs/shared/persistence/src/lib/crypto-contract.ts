import { z } from 'zod';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const protocolIdSchema = z.uuid().refine((value) => value === value.toLowerCase());
const name = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const counter = z.number().int().positive().max(2_147_483_647);

/** Base64url with no padding or unused-bit aliases, without a runtime codec. */
export function canonicalBase64url(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    return false;
  }

  const last = alphabet.indexOf(value[value.length - 1]);

  return value.length % 4 === 2 ? (last & 15) === 0 : value.length % 4 === 3 ? (last & 3) === 0 : true;
}

export function encodedBytes(length: number) {
  return z
    .string()
    .length(Math.ceil((length * 8) / 6))
    .refine(canonicalBase64url);
}

export const cryptoScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tenant'), tenantId: protocolIdSchema }),
  z.strictObject({ kind: z.literal('group'), tenantId: protocolIdSchema, groupId: protocolIdSchema }),
  z.strictObject({
    kind: z.literal('resource'),
    tenantId: protocolIdSchema,
    groupId: protocolIdSchema.nullable(),
    resourceId: protocolIdSchema,
  }),
]);
export type CryptoScope = z.infer<typeof cryptoScopeSchema>;

export function scopeTuple(scope: CryptoScope) {
  const parsed = cryptoScopeSchema.parse(scope);

  return [
    parsed.kind,
    parsed.tenantId,
    parsed.kind === 'tenant' ? null : parsed.groupId,
    parsed.kind === 'resource' ? parsed.resourceId : null,
  ] as const;
}

export function scopeContains(key: CryptoScope, target: CryptoScope): boolean {
  return (
    key.tenantId === target.tenantId &&
    (key.kind === 'tenant' ||
      (key.kind === 'group' && target.kind !== 'tenant' && key.groupId === target.groupId) ||
      (key.kind === 'resource' &&
        target.kind === 'resource' &&
        key.resourceId === target.resourceId &&
        key.groupId === target.groupId))
  );
}

export const keyDomainSchema = z.strictObject({
  product: name,
  domain: name,
  scope: cryptoScopeSchema,
  generation: counter,
});
export const dataContextSchema = z
  .strictObject({
    key: keyDomainSchema,
    target: cryptoScopeSchema,
    objectId: protocolIdSchema,
    schemaVersion: counter,
    revision: counter,
    kind: z.enum(['record', 'event', 'snapshot', 'tombstone']),
    previousCheckpoint: encodedBytes(32).nullable(),
  })
  .refine((context) => scopeContains(context.key.scope, context.target));
export const dataEnvelopeSchema = z.strictObject({
  format: z.literal('visomi.data'),
  version: z.literal(1),
  algorithm: z.literal('A256GCM'),
  context: dataContextSchema,
  nonce: encodedBytes(12),
  ciphertext: z
    .string()
    .min(22)
    .max(Math.ceil(((1_048_576 + 16) * 8) / 6))
    .refine(canonicalBase64url),
});
export type KeyDomain = z.infer<typeof keyDomainSchema>;
export type DataContext = z.infer<typeof dataContextSchema>;
export type DataEnvelope = z.infer<typeof dataEnvelopeSchema>;

export function dataAad(context: DataContext): string {
  const value = dataContextSchema.parse(context);

  return JSON.stringify([
    'visomi.data',
    1,
    'A256GCM',
    value.key.product,
    value.key.domain,
    scopeTuple(value.key.scope),
    scopeTuple(value.target),
    value.key.generation,
    value.objectId,
    value.schemaVersion,
    value.revision,
    value.kind,
    value.previousCheckpoint,
  ]);
}

export const wrappingContextSchema = z.strictObject({
  key: keyDomainSchema,
  ownerId: protocolIdSchema,
  deviceId: protocolIdSchema,
  method: z.enum(['passkey-prf', 'recovery-key']),
  methodId: z
    .string()
    .min(1)
    .max(1400)
    .regex(/^[A-Za-z0-9_-]+$/),
  origin: z.string().min(1).max(512),
});
export const wrappedKeySchema = z.strictObject({
  format: z.literal('visomi.wrap'),
  version: z.literal(1),
  algorithm: z.literal('A256GCM'),
  kdf: z.literal('HKDF-SHA-256'),
  context: wrappingContextSchema,
  salt: encodedBytes(32),
  nonce: encodedBytes(12),
  ciphertext: encodedBytes(48),
});
export type WrappingContext = z.infer<typeof wrappingContextSchema>;
export type WrappedKey = z.infer<typeof wrappedKeySchema>;

export function wrappingAad(context: WrappingContext): string {
  const value = wrappingContextSchema.parse(context);

  return JSON.stringify([
    'visomi.wrap',
    1,
    'A256GCM',
    'HKDF-SHA-256',
    value.key.product,
    value.key.domain,
    scopeTuple(value.key.scope),
    value.key.generation,
    value.ownerId,
    value.deviceId,
    value.method,
    value.methodId,
    value.origin,
  ]);
}

export type CryptoFailure =
  | 'malformed'
  | 'unsupported-version'
  | 'context-mismatch'
  | 'integrity-failure'
  | 'key-invalid'
  | 'quota-exceeded'
  | 'crypto-unavailable';

export class CryptoContractError extends Error {
  constructor(readonly code: CryptoFailure) {
    super(code);
    this.name = 'CryptoContractError';
  }
}

export function parseDataEnvelope(input: unknown): DataEnvelope {
  const result = dataEnvelopeSchema.safeParse(input);

  if (!result.success) {
    if (input && typeof input === 'object' && 'version' in input && input.version !== 1) {
      throw new CryptoContractError('unsupported-version');
    }

    throw new CryptoContractError('malformed');
  }

  return result.data;
}

/** Fixed schema field order is the v1 wire order; native implementations must match vectors. */
export function serializeDataEnvelope(input: unknown): string {
  return JSON.stringify(parseDataEnvelope(input));
}

export function deserializeDataEnvelope(serialized: string): DataEnvelope {
  if (serialized.length > 1_410_000) {
    throw new CryptoContractError('quota-exceeded');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new CryptoContractError('malformed');
  }

  const value = parseDataEnvelope(parsed);

  if (serializeDataEnvelope(value) !== serialized) {
    throw new CryptoContractError('malformed');
  }

  return value;
}

/** Runtime-neutral boundary; a platform supplies its own opaque key handle. */
export type VaultCrypto<Key> = {
  importDataKey(bytes: Uint8Array): Promise<Key>;
  seal(key: Key, context: DataContext, plaintext: Uint8Array): Promise<DataEnvelope>;
  open(key: Key, expected: DataContext, envelope: unknown): Promise<Uint8Array>;
};
