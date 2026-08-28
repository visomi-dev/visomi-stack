import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    passwordConfigured: boolean('password_configured').notNull().default(true),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('accounts_slug_idx').on(table.slug)],
);

const accountMemberships = pgTable(
  'account_memberships',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('account_memberships_account_user_idx').on(table.accountId, table.userId)],
);

const userSessions = pgTable('user_sessions', {
  sid: text('sid').primaryKey(),
  sess: jsonb('sess').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

const authVerificationChallenges = pgTable('auth_verification_challenges', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(),
  pinHash: text('pin_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  attemptCount: integer('attempt_count').default(0).notNull(),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

const accountPasskeyEnrollments = pgTable(
  'account_passkey_enrollments',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    credentialId: text('credential_id'),
    status: text('status').notNull().default('pending'),
    verificationChallengeId: text('verification_challenge_id').references(() => authVerificationChallenges.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('account_passkey_enrollments_account_status_idx').on(table.accountId, table.status)],
);

const accountPasskeyCredentials = pgTable(
  'account_passkey_credentials',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull(),
    publicKey: text('public_key').notNull(),
    rpId: text('rp_id').notNull(),
    label: text('label').notNull(),
    transports: jsonb('transports').$type<string[]>().notNull().default([]),
    signCount: integer('sign_count').notNull().default(0),
    backupEligible: boolean('backup_eligible').notNull().default(false),
    backupState: boolean('backup_state').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('account_passkey_credentials_credential_idx').on(table.credentialId),
    uniqueIndex('account_passkey_credentials_account_label_idx').on(table.accountId, table.label),
    index('account_passkey_credentials_account_status_idx').on(table.accountId, table.revokedAt),
  ],
);

const accountWebAuthnChallenges = pgTable(
  'account_webauthn_challenges',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    challengeHash: text('challenge_hash').notNull(),
    purpose: text('purpose').notNull(),
    rpId: text('rp_id').notNull(),
    origin: text('origin').notNull(),
    userVerification: text('user_verification').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('account_webauthn_challenges_hash_idx').on(table.challengeHash),
    index('account_webauthn_challenges_account_expiry_idx').on(table.accountId, table.expiresAt),
  ],
);

const userDevices = pgTable(
  'user_devices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_devices_token_hash_idx').on(table.tokenHash),
    index('user_devices_user_expires_idx').on(table.userId, table.expiresAt),
  ],
);

const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  tokenHash: text('token_hash').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

const userActivationMilestones = pgTable('user_activation_milestones', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  milestone: text('milestone').notNull(),
  metadataJson: text('metadata_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

const projects = pgTable('projects', {
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

const projectDocuments = pgTable('project_documents', {
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

const asyncJobs = pgTable('async_jobs', {
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

const opaqueSyncCursors = pgTable(
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

const opaqueSyncEnvelopes = pgTable(
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

const opaqueSyncTombstones = pgTable(
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

const opaqueSyncCheckpoints = pgTable(
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

const encryptedContextMetadata = pgTable(
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

const encryptedContextTombstones = pgTable(
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

const syncDevices = pgTable('sync_devices', {
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
const syncWorkspaceVersions = pgTable('sync_workspace_versions', {
  accountId: text('account_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  version: integer('version').notNull().default(0),
});
const syncWorkspaceApprovals = pgTable('sync_workspace_approvals', {
  accountId: text('account_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  deviceId: text('device_id').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
});
const syncDeviceGrants = pgTable('sync_device_grants', {
  accountId: text('account_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  deviceId: text('device_id').notNull(),
  enrollmentVersion: integer('enrollment_version').notNull(),
  objectKey: text('object_key').notNull(),
  ciphertextSha256: text('ciphertext_sha256').notNull(),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
const syncDeviceAudit = pgTable('sync_device_audit', {
  id: integer('id').primaryKey(),
  accountId: text('account_id').notNull(),
  deviceId: text('device_id').notNull(),
  kind: text('kind').notNull(),
  workspaceId: text('workspace_id'),
  at: timestamp('at', { withTimezone: true }).notNull(),
});

export {
  accounts,
  accountMemberships,
  apiKeys,
  asyncJobs,
  authVerificationChallenges,
  accountPasskeyCredentials,
  accountPasskeyEnrollments,
  accountWebAuthnChallenges,
  projectDocuments,
  projects,
  userActivationMilestones,
  userSessions,
  userDevices,
  users,
  opaqueSyncCursors,
  opaqueSyncEnvelopes,
  opaqueSyncTombstones,
  opaqueSyncCheckpoints,
  encryptedContextMetadata,
  encryptedContextTombstones,
  syncDevices,
  syncWorkspaceVersions,
  syncWorkspaceApprovals,
  syncDeviceGrants,
  syncDeviceAudit,
};
