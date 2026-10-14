import { getTableConfig } from 'drizzle-orm/pg-core';

import * as activity from './schema-activity';
import * as auth from './schema-auth';
import * as sync from './schema-sync';
import * as vault from './schema-vault';
import * as schema from './schema';

describe('database schema discovery boundaries', () => {
  it('exports each feature table exactly once using the original table instance', () => {
    const tables = { ...auth, ...sync, ...activity, ...vault };
    const discovered = { ...schema };

    expect(Object.keys(schema).sort()).toEqual(Object.keys(tables).sort());
    expect(Object.keys(schema)).toHaveLength(43);
    for (const name of Object.keys(tables) as (keyof typeof tables)[]) {
      expect(discovered[name]).toBe(tables[name]);
    }
    const tableNames = Object.values(schema).map((table) => getTableConfig(table).name);

    expect(new Set(tableNames).size).toBe(tableNames.length);
  });

  it('resolves cross-feature references to the same discovered table instances', () => {
    const exported = new Set<unknown>(Object.values(schema));

    for (const table of Object.values(schema)) {
      const config = getTableConfig(table);

      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();

        expect(exported.has(reference.foreignTable)).toBe(true);
        expect(reference.columns.length).toBe(reference.foreignColumns.length);
      }
    }
  });

  it('retains membership and credential custody deletion boundaries', () => {
    for (const table of [
      schema.pushSubscriptions,
      schema.pushDeliveries,
      schema.vaultPinProfiles,
      schema.vaultUnlockMethods,
      schema.vaultUnlockAssertions,
      schema.vaultBrowserEnrollments,
    ]) {
      const foreignKeys = getTableConfig(table).foreignKeys;
      const membership = foreignKeys.find((key) => key.reference().foreignTable === auth.accountMemberships);

      expect(membership?.onDelete).toBe('cascade');
      expect(membership?.reference().foreignColumns.map((column) => column.name)).toEqual(['account_id', 'user_id']);
    }
    for (const table of [schema.vaultUnlockMethods, schema.vaultUnlockAssertions]) {
      const credential = getTableConfig(table).foreignKeys.find(
        (key) => key.reference().foreignTable === auth.accountPasskeyCredentials,
      );

      expect(credential?.onDelete).toBe('cascade');
    }
  });
});
