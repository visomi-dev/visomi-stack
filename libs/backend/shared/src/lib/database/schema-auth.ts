import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'auth_users',
  {
    id: uuid('id').primaryKey(),
    email: text('email'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash'),
    authVersion: integer('auth_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_users_verified_email_idx')
      .on(t.email)
      .where(sql`${t.emailVerifiedAt} IS NOT NULL`),
    index('auth_users_email_idx').on(t.email),
    check('auth_users_version_check', sql`${t.authVersion} > 0`),
    check('auth_users_email_check', sql`${t.emailVerifiedAt} IS NULL OR ${t.email} IS NOT NULL`),
  ],
);

export const credentials = pgTable(
  'auth_credentials',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(),
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports').array().notNull().default([]),
    backupEligible: boolean('backup_eligible').notNull(),
    backupState: boolean('backup_state').notNull(),
    rpId: text('rp_id').notNull(),
    label: varchar('label', { length: 64 }).notNull().default('Passkey'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    pendingGrantId: uuid('pending_grant_id'),
  },
  (t) => [
    index('auth_credentials_owner_idx').on(t.userId, t.revokedAt),
    check('auth_credentials_counter_check', sql`${t.counter} >= 0 AND ${t.counter} <= 9007199254740991`),
    check('auth_credentials_backup_check', sql`NOT ${t.backupState} OR ${t.backupEligible}`),
    check(
      'auth_credentials_id_check',
      sql`length(${t.credentialId}) <= 1400 AND ${t.credentialId} ~ '^[A-Za-z0-9_-]+$'`,
    ),
    check('auth_credentials_key_check', sql`length(${t.publicKey}) > 0`),
    check('auth_credentials_label_check', sql`length(trim(${t.label})) > 0`),
    check(
      'auth_credentials_transports_check',
      sql`${t.transports} <@ ARRAY['usb','nfc','ble','internal','hybrid','cable','smart-card']::text[]`,
    ),
  ],
);

// connect-pg-simple's standard columns are retained; revocation is enforced by a migration trigger.
export const sessions = pgTable(
  'auth_sessions',
  {
    sid: varchar('sid', { length: 128 }).primaryKey(),
    sess: jsonb('sess').notNull(),
    expire: timestamp('expire', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'auth_sessions_revocation_check',
      sql`${t.revokedAt} IS NULL OR (${t.expire} <= ${t.revokedAt} AND ${t.sess} = '{}'::jsonb)`,
    ),
    index('auth_sessions_expiry_idx').on(t.expire),
    index('auth_sessions_user_idx').on(sql`(${t.sess}->'passport'->'user'->>'id')`),
  ],
);

export const challenges = pgTable(
  'auth_challenges',
  {
    id: uuid('id').primaryKey(),
    sessionId: varchar('session_id', { length: 128 })
      .notNull()
      .unique()
      .references(() => sessions.sid, { onDelete: 'cascade' }),
    purpose: text('purpose').$type<'signup' | 'enrollment' | 'authentication'>().notNull(),
    subjectId: uuid('subject_id'),
    email: text('email'),
    challengeHash: text('challenge_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_challenges_expiry_idx').on(t.expiresAt),
    check('auth_challenges_purpose_check', sql`${t.purpose} IN ('signup', 'enrollment', 'authentication')`),
    check('auth_challenges_subject_check', sql`(${t.purpose} = 'authentication') = (${t.subjectId} IS NULL)`),
    check('auth_challenges_hash_check', sql`${t.challengeHash} ~ '^[a-f0-9]{64}$'`),
    check('auth_challenges_expiration_check', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const rateLimits = pgTable(
  'auth_rate_limits',
  {
    key: text('key').primaryKey(),
    attempts: integer('attempts').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('auth_rate_limits_expiry_idx').on(t.expiresAt),
    check('auth_rate_limits_attempts_check', sql`${t.attempts} > 0 AND ${t.attempts} <= 10001`),
  ],
);

export type AuthFlowData = {
  nonce?: string;
  passwordHash?: string;
  requiredFactor?: 'email' | 'totp';
  factorId?: string;
  issuer?: string;
  subject?: string;
  providerEmail?: string;
  emailProven?: boolean;
  factorProven?: boolean;
  method?: 'passkey' | 'password' | 'google';
  methodId?: string;
  sourceApprovalId?: string;
};

export const flows = pgTable(
  'auth_flows',
  {
    id: uuid('id').primaryKey(),
    sessionId: varchar('session_id', { length: 128 })
      .notNull()
      .references(() => sessions.sid),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    authVersion: integer('auth_version'),
    purpose: text('purpose')
      .$type<
        | 'email_verify'
        | 'email_change'
        | 'password_login'
        | 'password_reset'
        | 'recovery'
        | 'google_login'
        | 'google_link'
        | 'google_reauth'
        | 'enrollment'
        | 'reauth'
      >()
      .notNull(),
    email: text('email'),
    codeHash: text('code_hash'),
    data: jsonb('data').$type<AuthFlowData>().notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    index('auth_flows_session_idx').on(t.sessionId),
    index('auth_flows_user_idx').on(t.userId),
    index('auth_flows_expiry_idx').on(t.expiresAt),
    check('auth_flows_attempts_check', sql`${t.attempts} BETWEEN 0 AND 5`),
    check(
      'auth_flows_purpose_check',
      sql`${t.purpose} IN ('email_verify','email_change','password_login','password_reset','recovery','google_login','google_link','google_reauth','enrollment','reauth')`,
    ),
  ],
);

export const federatedIdentities = pgTable(
  'auth_federated_identities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_federated_subject_idx').on(t.issuer, t.subject),
    index('auth_federated_user_idx').on(t.userId),
  ],
);

export const totpEnrollments = pgTable(
  'auth_totp_enrollments',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    encryptedSecret: text('encrypted_secret').notNull(),
    status: text('status').$type<'pending' | 'active' | 'revoked'>().notNull().default('pending'),
    lastStep: bigint('last_step', { mode: 'number' }).notNull().default(-1),
    sessionId: varchar('session_id', { length: 128 })
      .notNull()
      .references(() => sessions.sid),
    authVersion: integer('auth_version').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('auth_totp_active_idx')
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
    check('auth_totp_status_check', sql`${t.status} IN ('pending','active','revoked')`),
  ],
);

export const recoveryCodes = pgTable(
  'auth_recovery_codes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [index('auth_recovery_codes_user_idx').on(t.userId)],
);

export const deviceApprovals = pgTable(
  'auth_device_approvals',
  {
    id: uuid('id').primaryKey(),
    sessionId: varchar('session_id', { length: 128 })
      .notNull()
      .references(() => sessions.sid),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    userId: uuid('user_id').references(() => users.id),
    approverSessionId: varchar('approver_session_id', { length: 128 }).references(() => sessions.sid),
    approver: jsonb('approver').$type<{
      method: 'passkey' | 'password' | 'google';
      methodId?: string;
      authenticatedAt: number;
      version: number;
    }>(),
    status: text('status')
      .$type<'pending' | 'approved' | 'denied' | 'cancelled' | 'consumed'>()
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_device_approvals_expiry_idx').on(t.expiresAt),
    check(
      'auth_device_approvals_status_check',
      sql`${t.status} IN ('pending','approved','denied','cancelled','consumed')`,
    ),
    check('auth_device_approvals_attempts_check', sql`${t.attempts} BETWEEN 0 AND 5`),
  ],
);
