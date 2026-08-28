import { defineConfig } from 'drizzle-kit';

const URL = process.env['DATABASE_URL'];

if (!URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export default defineConfig({
  schema: './libs/shared/src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: URL,
  },
});
