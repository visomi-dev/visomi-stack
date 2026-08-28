import { z } from 'zod';

/** The complete domain projection carried inside a project-local materialization. */
export const projectEntityKinds = [
  'project',
  'epic',
  'work-item',
  'dependency',
  'sprint',
  'sprint-revision',
  'membership',
  'sprint-evidence',
  'run',
  'run-evidence',
  'review',
  'claim',
  'status-transition',
  'activity',
  'timeline-event',
] as const;

export type ProjectEntityKind = (typeof projectEntityKinds)[number];

const opaqueValue = z.string().min(1);
const projectId = z.string().min(1);

export const projectSyncEnvelopeSchema = z
  .object({
    format: z.literal('themis.project-sync-envelope'),
    version: z.literal(1),
    streamKind: z.enum(['event', 'snapshot', 'tombstone']),
    projectId,
    envelopeId: opaqueValue,
    idempotencyKey: opaqueValue,
    revision: z.number().int().positive(),
    baseCursor: z.number().int().nonnegative(),
    entityKind: z.enum(projectEntityKinds),
    nonce: opaqueValue,
    ciphertext: opaqueValue,
    authTag: opaqueValue,
  })
  .strict();

export type ProjectSyncEnvelope = z.infer<typeof projectSyncEnvelopeSchema>;

export const projectCursorSchema = z
  .object({
    projectId,
    cursor: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    checkpointId: z.string().min(1).nullable(),
    tombstoneHorizon: z.number().int().nonnegative(),
  })
  .strict();

export type ProjectCursor = z.infer<typeof projectCursorSchema>;

export const projectNotificationSchema = z
  .object({
    format: z.literal('themis.project-sync-notification'),
    version: z.literal(1),
    projectId,
    latestCursor: z.number().int().nonnegative(),
    latestRevision: z.number().int().nonnegative(),
    checkpointHint: z.string().min(1).nullable(),
    streamKind: z.enum(['event', 'snapshot', 'tombstone']),
    correlationId: opaqueValue,
  })
  .strict();

export type ProjectNotification = z.infer<typeof projectNotificationSchema>;

export const materializationStateSchema = z
  .object({
    projectId,
    schemaVersion: z.literal(1),
    cursor: projectCursorSchema,
    status: z.enum(['empty', 'loading', 'ready', 'stale', 'locked', 'corrupt', 'quota-exceeded']),
    lastErrorCode: z.string().min(1).nullable(),
  })
  .strict();

export type MaterializationState = z.infer<typeof materializationStateSchema>;

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

function canonicalize(value: unknown): CanonicalJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  throw new Error('Project sync contract contains a non-canonical value.');
}

/** Runtime-neutral canonical wire serialization; plaintext never appears in this contract. */
export function serializeProjectSyncEnvelope(input: unknown): string {
  return JSON.stringify(canonicalize(projectSyncEnvelopeSchema.parse(input)));
}

export function parseProjectSyncEnvelope(input: unknown): ProjectSyncEnvelope {
  return projectSyncEnvelopeSchema.parse(input);
}
