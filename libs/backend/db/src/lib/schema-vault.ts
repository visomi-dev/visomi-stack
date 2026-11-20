import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { DataEnvelope, DeviceChallenge, ApprovedDelivery } from '@visomi-stack/shared-db';

import { memberships, scopes } from './schema-persistence';

export type VaultObjectReference = {
  format: 'vault-object';
  version: 1;
  id: string;
  digest: string;
  generation: number;
};
type StoredEnvelope = DataEnvelope | VaultObjectReference;

export const keyScopes = pgTable(
  'vault_key_scopes',
  {
    tenantId: uuid('tenant_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    domain: text('domain').notNull(),
    generation: integer('generation').notNull().default(1),
    epoch: integer('epoch').notNull().default(1),
    phase: text('phase').$type<'ready' | 'rotating'>().notNull().default('ready'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.scopeId, t.domain] }),
    foreignKey({ columns: [t.tenantId, t.scopeId], foreignColumns: [scopes.tenantId, scopes.id] }).onDelete('cascade'),
    check('vault_key_generation', sql`${t.generation} > 0 AND ${t.epoch} > 0`),
    check('vault_key_phase', sql`${t.phase} IN ('ready','rotating')`),
  ],
);

export const opaqueStreams = pgTable(
  'vault_opaque_streams',
  {
    tenantId: uuid('tenant_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    domain: text('domain').notNull(),
    cursor: integer('cursor').notNull().default(0),
    checkpoint: text('checkpoint'),
    floorCursor: integer('floor_cursor').notNull().default(0),
    floorCheckpoint: text('floor_checkpoint'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.scopeId, t.domain] }),
    foreignKey({ columns: [t.tenantId, t.scopeId], foreignColumns: [scopes.tenantId, scopes.id] }).onDelete('cascade'),
    check(
      'vault_stream_cursor',
      sql`(${t.cursor} = 0 AND ${t.checkpoint} IS NULL) OR (${t.cursor} > 0 AND ${t.checkpoint} IS NOT NULL)`,
    ),
    check(
      'vault_stream_floor',
      sql`${t.floorCursor} >= 0 AND ${t.floorCursor} <= ${t.cursor} AND ((${t.floorCursor} = 0 AND ${t.floorCheckpoint} IS NULL) OR (${t.floorCursor} > 0 AND ${t.floorCheckpoint} IS NOT NULL))`,
    ),
  ],
);

export const keyDevices = pgTable(
  'vault_key_devices',
  {
    tenantId: uuid('tenant_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    domain: text('domain').notNull(),
    id: uuid('id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    signing: text('signing').notNull(),
    encryption: text('encryption').notNull(),
    challenge: jsonb('challenge').$type<DeviceChallenge>().notNull(),
    delivery: jsonb('delivery').$type<ApprovedDelivery>(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.scopeId, t.domain, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.scopeId, t.domain],
      foreignColumns: [keyScopes.tenantId, keyScopes.scopeId, keyScopes.domain],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.ownerId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete('cascade'),
  ],
);

export const keyChallenges = pgTable(
  'vault_key_challenges',
  {
    tenantId: uuid('tenant_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    domain: text('domain').notNull(),
    id: uuid('id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    value: jsonb('value').$type<DeviceChallenge>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.scopeId, t.domain, t.id] }),
    foreignKey({ columns: [t.tenantId, t.scopeId], foreignColumns: [scopes.tenantId, scopes.id] }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.ownerId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete('cascade'),
  ],
);

export const opaqueUnits = pgTable(
  'vault_opaque_units',
  {
    tenantId: uuid('tenant_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    domain: text('domain').notNull(),
    id: uuid('id').notNull(),
    revision: integer('revision').notNull(),
    generation: integer('generation').notNull(),
    cursor: integer('cursor').notNull(),
    checkpoint: text('checkpoint').notNull(),
    envelope: jsonb('envelope').$type<StoredEnvelope>(),
    tombstone: boolean('tombstone').notNull().default(false),
    bytes: integer('bytes').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.scopeId, t.domain, t.id] }),
    foreignKey({ columns: [t.tenantId, t.scopeId], foreignColumns: [scopes.tenantId, scopes.id] }).onDelete('cascade'),
    check(
      'vault_unit_versions',
      sql`${t.revision} > 0 AND ${t.generation} > 0 AND ${t.cursor} > 0 AND ${t.bytes} >= 0`,
    ),
    check(
      'vault_unit_gravestone',
      sql`(${t.envelope} IS NOT NULL AND ${t.bytes} > 0) OR (${t.envelope} IS NULL AND ${t.tombstone} AND ${t.bytes} = 0)`,
    ),
  ],
);

export const opaqueEvents = pgTable(
  'vault_opaque_events',
  {
    tenantId: uuid('tenant_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    domain: text('domain').notNull(),
    cursor: integer('cursor').notNull(),
    checkpoint: text('checkpoint').notNull(),
    previousCheckpoint: text('previous_checkpoint'),
    envelope: jsonb('envelope').$type<StoredEnvelope>().notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.scopeId, t.domain, t.cursor] }),
    foreignKey({ columns: [t.tenantId, t.scopeId], foreignColumns: [scopes.tenantId, scopes.id] }).onDelete('cascade'),
    index('vault_event_retention').on(t.tenantId, t.scopeId, t.domain, t.createdAt),
  ],
);

export const opaqueCommands = pgTable(
  'vault_opaque_commands',
  {
    tenantId: uuid('tenant_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    domain: text('domain').notNull(),
    userId: uuid('user_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    cursor: integer('cursor').notNull(),
    checkpoint: text('checkpoint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.scopeId, t.domain, t.userId, t.operationId] }),
    foreignKey({ columns: [t.tenantId, t.scopeId], foreignColumns: [scopes.tenantId, scopes.id] }).onDelete('cascade'),
    index('vault_command_retention').on(t.tenantId, t.scopeId, t.domain, t.createdAt),
  ],
);
