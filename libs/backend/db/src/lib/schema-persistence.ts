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
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './schema-auth';

export const tenants = pgTable(
  'persistence_tenants',
  {
    id: uuid('id').primaryKey(),
    product: text('product').notNull(),
    policyHash: text('policy_hash').notNull(),
    epoch: integer('epoch').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('persistence_tenant_epoch', sql`${t.epoch} > 0`)],
);

export const memberships = pgTable(
  'persistence_memberships',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    owner: boolean('owner').notNull().default(false),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index('persistence_membership_user').on(t.userId)],
);

export const scopes = pgTable(
  'persistence_scopes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'tenant' | 'group' | 'resource'>().notNull(),
    parentId: uuid('parent_id'),
    objectBackup: boolean('object_backup').notNull().default(false),
  },
  (t) => [
    unique('persistence_scope_tenant_id').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.parentId], foreignColumns: [t.tenantId, t.id] }),
    check('persistence_scope_kind', sql`${t.kind} IN ('tenant','group','resource')`),
    check('persistence_scope_object_backup', sql`NOT ${t.objectBackup} OR ${t.kind} = 'resource'`),
    check(
      'persistence_scope_root',
      sql`(${t.kind} = 'tenant' AND ${t.id} = ${t.tenantId} AND ${t.parentId} IS NULL) OR (${t.kind} <> 'tenant' AND ${t.parentId} IS NOT NULL AND ${t.id} <> ${t.parentId})`,
    ),
    index('persistence_scope_parent').on(t.tenantId, t.parentId),
  ],
);

export const grants = pgTable(
  'persistence_grants',
  {
    tenantId: uuid('tenant_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').$type<'viewer' | 'editor' | 'manager' | 'blocked'>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.scopeId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.scopeId], foreignColumns: [scopes.tenantId, scopes.id] }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete('cascade'),
    check('persistence_grant_role', sql`${t.role} IN ('viewer','editor','manager','blocked')`),
  ],
);

export const records = pgTable(
  'persistence_records',
  {
    id: uuid('id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    domain: text('domain').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    audience: text('audience').$type<'owner' | 'scope'>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    revision: integer('revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.scopeId], foreignColumns: [scopes.tenantId, scopes.id] }).onDelete('cascade'),
    check('persistence_record_revision', sql`${t.revision} > 0`),
    check('persistence_record_audience', sql`${t.audience} IN ('owner','scope')`),
    index('persistence_record_page').on(t.tenantId, t.scopeId, t.domain, t.id),
  ],
);

export const commands = pgTable(
  'persistence_commands',
  {
    tenantId: uuid('tenant_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    domain: text('domain').notNull().default('unclassified'),
    userId: uuid('user_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    result: jsonb('result').$type<{ id: string; revision: number; deleted: boolean }>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.scopeId, t.userId, t.operationId] }),
    foreignKey({ columns: [t.tenantId, t.scopeId], foreignColumns: [scopes.tenantId, scopes.id] }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete('cascade'),
    index('persistence_command_retention').on(t.tenantId, t.scopeId, t.domain, t.createdAt),
  ],
);
