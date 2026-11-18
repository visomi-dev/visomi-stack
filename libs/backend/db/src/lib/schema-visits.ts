import { bigint, date, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core';

export const siteVisitDays = pgTable(
  'site_visit_days',
  {
    site: varchar({ length: 40 }).notNull(),
    day: date().notNull(),
    page: varchar({ length: 40 }).notNull(),
    locale: varchar({ length: 2 }).notNull(),
    views: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.site, table.day, table.page, table.locale] })],
);
