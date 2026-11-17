import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/schema.ts',
  out: './src/lib/migrations',
  dbCredentials: process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : undefined,
});
