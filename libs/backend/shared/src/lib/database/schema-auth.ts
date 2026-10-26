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
} from 'drizzle-orm/pg-core';

export const users = pgTable('auth_users', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
