import { getTableConfig } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';

import { siteVisitDays } from './schema-visits';

it('identifies each bucket by site, day, page and locale', () => {
  const table = getTableConfig(siteVisitDays);

  expect(table.name).toBe('site_visit_days');
  expect(table.primaryKeys[0].columns.map((column) => column.name)).toEqual(['site', 'day', 'page', 'locale']);
});
