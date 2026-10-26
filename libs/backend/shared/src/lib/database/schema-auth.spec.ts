import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  challenges,
  credentials,
  rateLimits,
  sessions,
  users,
  flows,
  federatedIdentities,
  totpEnrollments,
  recoveryCodes,
  deviceApprovals,
} from './schema-auth';

describe('authentication schema contract', () => {
  it('defines stable primary keys and required columns for every persisted capability', () => {
    for (const table of [
      users,
      credentials,
      sessions,
      challenges,
      rateLimits,
      flows,
      federatedIdentities,
      totpEnrollments,
      recoveryCodes,
      deviceApprovals,
    ]) {
      const config = getTableConfig(table);

      expect(config.columns.filter((column) => column.primary)).toHaveLength(1);
      expect(config.columns.filter((column) => column.primary)[0].notNull).toBe(true);
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();

        expect(reference.columns).toHaveLength(reference.foreignColumns.length);
        expect(reference.foreignTable).toBeDefined();
      }
    }
    expect(credentials.credentialId.isUnique).toBe(true);
    expect(challenges.sessionId.isUnique).toBe(true);
  });

  it('binds credentials to users and challenges to sessions with cascading foreign keys', () => {
    for (const [table, owner] of [
      [credentials, users],
      [challenges, sessions],
    ] as const) {
      const [foreignKey] = getTableConfig(table).foreignKeys;

      expect(foreignKey.reference().foreignTable).toBe(owner);
      expect(foreignKey.onDelete).toBe('cascade');
    }
  });

  it('declares owner and expiration indexes alongside database-enforced security constraints', () => {
    expect(getTableConfig(credentials).checks.map((constraint) => constraint.name)).toEqual([
      'auth_credentials_counter_check',
      'auth_credentials_backup_check',
      'auth_credentials_id_check',
      'auth_credentials_key_check',
      'auth_credentials_label_check',
      'auth_credentials_transports_check',
    ]);
    expect(getTableConfig(challenges).checks.map((constraint) => constraint.name)).toContain(
      'auth_challenges_subject_check',
    );
    expect(getTableConfig(sessions).checks.map((constraint) => constraint.name)).toEqual([
      'auth_sessions_revocation_check',
    ]);
    expect(getTableConfig(rateLimits).checks.map((constraint) => constraint.name)).toEqual([
      'auth_rate_limits_attempts_check',
    ]);
    expect(getTableConfig(sessions).indexes.map((entry) => entry.config.name)).toContain('auth_sessions_user_idx');
  });
});
