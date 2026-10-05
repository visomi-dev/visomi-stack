import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { accountMemberships, accountPasskeyCredentials } from './schema-auth';

import type { BrowserVaultPairing, DeviceKeyEnvelope, PrfKeyEnvelope, VaultPinProfile } from 'shared-crypto';

export const vaultPinProfiles = pgTable(
  'vault_pin_profiles',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    userId: text('user_id').notNull(),
    profile: jsonb('profile').$type<VaultPinProfile>(),
    active: boolean('active').notNull().default(true),
    attempts: integer('attempts').notNull().default(0),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('vault_pin_profiles_owner_idx').on(table.accountId, table.userId),
    check('vault_pin_profiles_attempts_check', sql`${table.attempts} BETWEEN 0 AND 5`),
    foreignKey({
      name: 'vault_pin_profiles_membership_fk',
      columns: [table.accountId, table.userId],
      foreignColumns: [accountMemberships.accountId, accountMemberships.userId],
    }).onDelete('cascade'),
  ],
);

export const vaultUnlockMethods = pgTable(
  'vault_unlock_methods',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    userId: text('user_id').notNull(),
    credentialRecordId: text('credential_record_id')
      .notNull()
      .references(() => accountPasskeyCredentials.id, { onDelete: 'cascade' }),
    envelope: jsonb('envelope').$type<PrfKeyEnvelope>().notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('vault_unlock_methods_active_credential_idx')
      .on(table.accountId, table.userId, table.credentialRecordId)
      .where(sql`${table.revokedAt} IS NULL`),
    check('vault_unlock_methods_revision_check', sql`${table.revision} > 0`),
    foreignKey({
      name: 'vault_unlock_methods_membership_fk',
      columns: [table.accountId, table.userId],
      foreignColumns: [accountMemberships.accountId, accountMemberships.userId],
    }).onDelete('cascade'),
  ],
);

export const vaultUnlockAssertions = pgTable(
  'vault_unlock_assertions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    userId: text('user_id').notNull(),
    credentialRecordId: text('credential_record_id')
      .notNull()
      .references(() => accountPasskeyCredentials.id, { onDelete: 'cascade' }),
    authVersion: integer('auth_version').notNull(),
    sessionHash: text('session_hash').notNull(),
    purpose: text('purpose').$type<'enroll' | 'unlock'>().notNull(),
    methodId: text('method_id').notNull(),
    prfInput: text('prf_input').notNull(),
    challenge: text('challenge').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (table) => [
    index('vault_unlock_assertions_owner_expiry_idx').on(table.accountId, table.userId, table.expiresAt),
    check(
      'vault_unlock_assertions_purpose_check',
      sql`${table.purpose} IN ('enroll', 'unlock') AND ${table.authVersion} > 0`,
    ),
    foreignKey({
      name: 'vault_unlock_assertions_membership_fk',
      columns: [table.accountId, table.userId],
      foreignColumns: [accountMemberships.accountId, accountMemberships.userId],
    }).onDelete('cascade'),
  ],
);

export const vaultBrowserEnrollments = pgTable(
  'vault_browser_enrollments',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    userId: text('user_id').notNull(),
    authVersion: integer('auth_version').notNull(),
    sessionHash: text('session_hash').notNull(),
    pairing: jsonb('pairing').$type<BrowserVaultPairing>().notNull(),
    envelope: jsonb('envelope').$type<DeviceKeyEnvelope>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('vault_browser_enrollments_owner_expiry_idx').on(table.accountId, table.userId, table.expiresAt),
    check('vault_browser_enrollments_version_check', sql`${table.authVersion} > 0`),
    foreignKey({
      name: 'vault_browser_enrollments_membership_fk',
      columns: [table.accountId, table.userId],
      foreignColumns: [accountMemberships.accountId, accountMemberships.userId],
    }).onDelete('cascade'),
  ],
);
