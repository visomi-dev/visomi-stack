import { z } from 'zod';

const base64UrlSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url without padding');

const metadataSchema = z.record(z.string(), z.string());

export const encryptedEnvelopeSchema = z
  .object({
    format: z.literal('themis.encrypted-envelope'),
    version: z.literal(1),
    kind: z.enum(['local-record', 'sync-object']),
    envelopeId: z.string().min(1),
    workspaceId: z.string().min(1),
    recordType: z.string().min(1),
    revision: z.number().int().positive(),
    createdAt: z.iso.datetime({ precision: 3 }),
    associatedData: metadataSchema,
    metadata: metadataSchema,
    nonce: base64UrlSchema,
    ciphertext: base64UrlSchema.max(100_000),
    authTag: base64UrlSchema,
  })
  .strict();

export type EncryptedEnvelope = z.infer<typeof encryptedEnvelopeSchema>;
export type EnvelopeKind = EncryptedEnvelope['kind'];

export type EnvelopeErrorCode = 'malformed' | 'unsupported-version' | 'non-canonical' | 'replay' | 'integrity-failure';

export class EnvelopeContractError extends Error {
  constructor(
    readonly code: EnvelopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EnvelopeContractError';
  }
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

/** Compares UTF-16 code units so ordering is independent of runtime locale. */
function compareCanonicalKeys(left: string, right: string): number {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);

    if (difference !== 0) {
      return difference;
    }
  }

  return left.length - right.length;
}

function canonicalize(value: unknown): CanonicalJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new EnvelopeContractError('malformed', 'Envelope contains a non-finite number.');
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCanonicalKeys(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)] as const);

    return Object.fromEntries(entries);
  }

  throw new EnvelopeContractError('malformed', 'Envelope contains an unsupported JSON value.');
}

function validateEnvelope(input: unknown): EncryptedEnvelope {
  const result = encryptedEnvelopeSchema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const hasUnsupportedVersion =
    typeof input === 'object' && input !== null && 'version' in input && (input as { version?: unknown }).version !== 1;

  throw new EnvelopeContractError(
    hasUnsupportedVersion ? 'unsupported-version' : 'malformed',
    hasUnsupportedVersion ? 'Envelope version is not supported.' : 'Envelope is malformed.',
  );
}

/** Serializes an envelope with recursively sorted object keys and no whitespace. */
export function serializeEncryptedEnvelope(input: unknown): string {
  return JSON.stringify(canonicalize(validateEnvelope(input)));
}

/** Parses a structured envelope, normalizing no values and rejecting invalid input. */
export function parseEncryptedEnvelope(input: unknown): EncryptedEnvelope {
  return validateEnvelope(input);
}

/** Decodes the wire form and rejects alternate byte representations of the same envelope. */
export function deserializeEncryptedEnvelope(serialized: string): EncryptedEnvelope {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new EnvelopeContractError('malformed', 'Envelope is not valid JSON.');
  }

  const envelope = validateEnvelope(parsed);

  if (serializeEncryptedEnvelope(envelope) !== serialized) {
    throw new EnvelopeContractError('non-canonical', 'Envelope JSON is not canonical.');
  }

  return envelope;
}

/**
 * The contract validates integrity fields but deliberately does not select an algorithm.
 * A future crypto implementation supplies the authenticated-tag comparison.
 */
export function assertIntegrityTag(envelope: EncryptedEnvelope, valid: boolean): void {
  if (!valid) {
    throw new EnvelopeContractError(
      'integrity-failure',
      `Envelope ${envelope.envelopeId} failed integrity verification.`,
    );
  }
}

export class EnvelopeReplayGuard {
  private readonly highestRevision = new Map<string, number>();

  accept(envelope: EncryptedEnvelope): void {
    const previousRevision = this.highestRevision.get(envelope.envelopeId);

    if (previousRevision !== undefined && envelope.revision <= previousRevision) {
      throw new EnvelopeContractError(
        'replay',
        `Envelope ${envelope.envelopeId} revision ${envelope.revision} is not newer than ${previousRevision}.`,
      );
    }
    this.highestRevision.set(envelope.envelopeId, envelope.revision);
  }
}
