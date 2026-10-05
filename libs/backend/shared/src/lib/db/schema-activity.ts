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

import { accountMemberships, accounts, users } from './schema-auth';

export const durableOperations = pgTable(
  'durable_operations',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    requestKey: text('request_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    sessionId: text('session_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    authVersion: integer('auth_version').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    status: text('status').$type<'pending' | 'running' | 'completed' | 'failed'>().notNull().default('pending'),
    result: jsonb('result').$type<unknown>(),
    error: jsonb('error').$type<{ code: string; status: number }>(),
    attempts: integer('attempts').notNull().default(0),
    lease: text('lease'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('durable_operations_request_idx').on(table.owner, table.requestKey),
    index('durable_operations_pending_idx').on(table.status, table.availableAt),
    check('durable_operations_status_check', sql`${table.status} IN ('pending', 'running', 'completed', 'failed')`),
  ],
);

export const notificationInbox = pgTable(
  'notification_inbox',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'service' | 'security'>().notNull(),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notification_inbox_owner_idx').on(table.accountId, table.userId, table.createdAt),
    check('notification_inbox_kind_check', sql`${table.kind} IN ('service', 'security')`),
  ],
);
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    servicePush: boolean('service_push').notNull().default(false),
  },
  (table) => [uniqueIndex('notification_preferences_owner_idx').on(table.accountId, table.userId)],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    userId: text('user_id').notNull(),
    sessionId: text('session_id').notNull(),
    sessionBinding: text('session_binding').notNull(),
    authVersion: integer('auth_version').notNull(),
    endpointHash: text('endpoint_hash').notNull(),
    subscription: jsonb('subscription').$type<{ endpoint: string; keys: { p256dh: string; auth: string } }>().notNull(),
    revision: integer('revision').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('push_subscriptions_endpoint_idx').on(table.endpointHash),
    uniqueIndex('push_subscriptions_owner_session_idx').on(table.accountId, table.userId, table.sessionBinding),
    index('push_subscriptions_session_idx').on(table.sessionId),
    index('push_subscriptions_expiry_idx').on(table.expiresAt),
    check('push_subscriptions_version_check', sql`${table.authVersion} > 0 AND ${table.revision} > 0`),
    foreignKey({
      name: 'push_subscriptions_membership_fk',
      columns: [table.accountId, table.userId],
      foreignColumns: [accountMemberships.accountId, accountMemberships.userId],
    }).onDelete('cascade'),
  ],
);

export const pushDeliveries = pgTable(
  'push_deliveries',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    userId: text('user_id').notNull(),
    notificationId: text('notification_id')
      .notNull()
      .references(() => notificationInbox.id, { onDelete: 'cascade' }),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    status: text('status').$type<'pending' | 'running' | 'finished'>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lease: text('lease'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('push_deliveries_event_idx').on(table.notificationId, table.subscriptionId),
    index('push_deliveries_pending_idx').on(table.status, table.availableAt),
    check('push_deliveries_status_check', sql`${table.status} IN ('pending', 'running', 'finished')`),
    check('push_deliveries_attempts_check', sql`${table.attempts} BETWEEN 0 AND 3 AND ${table.revision} > 0`),
    foreignKey({
      name: 'push_deliveries_membership_fk',
      columns: [table.accountId, table.userId],
      foreignColumns: [accountMemberships.accountId, accountMemberships.userId],
    }).onDelete('cascade'),
  ],
);
