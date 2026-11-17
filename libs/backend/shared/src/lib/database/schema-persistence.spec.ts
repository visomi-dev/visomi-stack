import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { commands, grants, memberships, records, scopes, tenants } from './schema-persistence';
import {
  keyChallenges,
  keyDevices,
  keyScopes,
  opaqueCommands,
  opaqueEvents,
  opaqueStreams,
  opaqueUnits,
} from './schema-vault';

describe('persistence database security boundaries', () => {
  it('keeps persisted capabilities keyed and same-tenant references composite', () => {
    for (const table of [
      tenants,
      scopes,
      memberships,
      grants,
      records,
      commands,
      keyChallenges,
      keyDevices,
      keyScopes,
      opaqueCommands,
      opaqueEvents,
      opaqueStreams,
      opaqueUnits,
    ]) {
      const config = getTableConfig(table);

      expect(config.columns.some((column) => column.primary) || config.primaryKeys.length > 0).toBe(true);

      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();

        expect(reference.foreignColumns.length).toBe(reference.columns.length);
      }
    }

    for (const table of [grants, records, commands]) {
      const scoped = getTableConfig(table).foreignKeys.find(
        (foreignKey) => foreignKey.reference().foreignTable === scopes,
      );

      expect(scoped.reference().columns.map((column) => column.name)).toEqual(['tenant_id', 'scope_id']);
      expect(scoped.reference().foreignColumns.map((column) => column.name)).toEqual(['tenant_id', 'id']);
      expect(scoped.onDelete).toBe('cascade');
    }
  });

  it('keeps ciphertext history and device registries scoped and constrains generations', () => {
    expect(getTableConfig(keyScopes).checks.map((check) => check.name)).toEqual([
      'vault_key_generation',
      'vault_key_phase',
    ]);
    expect(getTableConfig(opaqueUnits).checks.map((check) => check.name)).toContain('vault_unit_versions');
    expect(getTableConfig(opaqueStreams).checks.map((check) => check.name)).toContain('vault_stream_cursor');
    expect(getTableConfig(opaqueStreams).checks.map((check) => check.name)).toContain('vault_stream_floor');
    expect(getTableConfig(opaqueUnits).checks.map((check) => check.name)).toContain('vault_unit_gravestone');
    for (const table of [keyScopes, keyChallenges, opaqueStreams, opaqueUnits, opaqueEvents, opaqueCommands]) {
      const reference = getTableConfig(table).foreignKeys.find((key) => key.reference().foreignTable === scopes);

      expect(reference.reference().columns.map((column) => column.name)).toEqual(['tenant_id', 'scope_id']);
    }
    const registry = getTableConfig(keyDevices).foreignKeys.find((key) => key.reference().foreignTable === keyScopes);

    expect(registry.reference().columns.map((column) => column.name)).toEqual(['tenant_id', 'scope_id', 'domain']);
  });

  it('declares ancestry, revision and role checks with scoped pagination indexes', () => {
    expect(getTableConfig(scopes).checks.map((entry) => entry.name)).toContain('persistence_scope_root');
    expect(getTableConfig(grants).checks.map((entry) => entry.name)).toContain('persistence_grant_role');
    expect(getTableConfig(records).checks.map((entry) => entry.name)).toEqual([
      'persistence_record_revision',
      'persistence_record_audience',
    ]);
    expect(
      getTableConfig(records).indexes[0].config.columns.map((column) => ('name' in column ? column.name : null)),
    ).toEqual(['tenant_id', 'scope_id', 'domain', 'id']);
  });
});
