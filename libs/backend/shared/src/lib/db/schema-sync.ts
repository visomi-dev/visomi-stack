import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { accounts, users } from './schema-auth';

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').notNull().default('active'),
  sourceType: text('source_type').notNull().default('manual'),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const projectDocuments = pgTable('project_documents', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  documentType: text('document_type').notNull(),
  status: text('status').notNull().default('active'),
  source: text('source').notNull().default('manual'),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const asyncJobs = pgTable('async_jobs', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  status: text('status').notNull(),
  progress: integer('progress').default(0).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const opaqueSyncCursors = pgTable(
  'opaque_sync_cursors',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    highWaterCursor: integer('high_water_cursor').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('opaque_sync_cursors_account_workspace_idx').on(table.accountId, table.workspaceId)],
);

export const opaqueSyncEnvelopes = pgTable(
  'opaque_sync_envelopes',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    envelopeId: text('envelope_id').notNull(),
    revision: integer('revision').notNull(),
    cursor: integer('cursor').notNull(),
    objectKey: text('object_key').notNull(),
    ciphertextSha256: text('ciphertext_sha256').notNull(),
    recordType: text('record_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('opaque_sync_envelopes_identity_idx').on(
      table.accountId,
      table.workspaceId,
      table.envelopeId,
      table.revision,
    ),
    uniqueIndex('opaque_sync_envelopes_cursor_idx').on(table.accountId, table.workspaceId, table.cursor),
  ],
);

export const opaqueSyncTombstones = pgTable(
  'opaque_sync_tombstones',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    envelopeId: text('envelope_id').notNull(),
    revision: integer('revision').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('opaque_sync_tombstones_identity_idx').on(
      table.accountId,
      table.workspaceId,
      table.envelopeId,
      table.revision,
    ),
  ],
);

export const opaqueSyncCheckpoints = pgTable(
  'opaque_sync_checkpoints',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    checkpointId: text('checkpoint_id').notNull(),
    cursor: integer('cursor').notNull(),
    revision: integer('revision').notNull(),
    objectKey: text('object_key').notNull(),
    ciphertextSha256: text('ciphertext_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('opaque_sync_checkpoints_identity_idx').on(table.accountId, table.workspaceId, table.checkpointId),
    uniqueIndex('opaque_sync_checkpoints_cursor_idx').on(table.accountId, table.workspaceId, table.cursor),
    index('opaque_sync_checkpoints_stream_idx').on(table.accountId, table.workspaceId, table.cursor),
  ],
);

export const encryptedContextMetadata = pgTable(
  'encrypted_context_metadata',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    envelopeId: text('envelope_id').notNull(),
    revision: integer('revision').notNull(),
    objectKey: text('object_key').notNull(),
    ciphertextSha256: text('ciphertext_sha256').notNull(),
    recordType: text('record_type').notNull(),
    state: text('state').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('encrypted_context_metadata_scope_idx').on(table.accountId, table.projectId, table.sourceId)],
);

export const encryptedContextTombstones = pgTable(
  'encrypted_context_tombstones',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    envelopeId: text('envelope_id').notNull(),
    revision: integer('revision').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('encrypted_context_tombstones_scope_idx').on(table.accountId, table.projectId, table.sourceId),
  ],
);

export const syncDevices = pgTable('sync_devices', {
  deviceId: text('device_id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(),
  fingerprint: text('fingerprint').notNull(),
  label: text('label').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
export const syncWorkspaceVersions = pgTable('sync_workspace_versions', {
  accountId: text('account_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  version: integer('version').notNull().default(0),
});
export const syncWorkspaceApprovals = pgTable('sync_workspace_approvals', {
  accountId: text('account_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  deviceId: text('device_id').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
});
export const syncDeviceGrants = pgTable('sync_device_grants', {
  accountId: text('account_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  deviceId: text('device_id').notNull(),
  enrollmentVersion: integer('enrollment_version').notNull(),
  objectKey: text('object_key').notNull(),
  ciphertextSha256: text('ciphertext_sha256').notNull(),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
export const syncDeviceAudit = pgTable('sync_device_audit', {
  id: integer('id').primaryKey(),
  accountId: text('account_id').notNull(),
  deviceId: text('device_id').notNull(),
  kind: text('kind').notNull(),
  workspaceId: text('workspace_id'),
  at: timestamp('at', { withTimezone: true }).notNull(),
});
