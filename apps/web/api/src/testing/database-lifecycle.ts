import type { PGlite } from '@electric-sql/pglite';

// Shared runtime imports can start the composed memory database even when a suite
// replaces `db` with its own fixture. Drain that original initialization as well; otherwise
// its asynchronous WASM imports can outlive Jest's ESM environment.
const key = Symbol.for('visomi.memory.database');
const registry = globalThis as typeof globalThis & { [key]?: PGlite };

beforeAll(async () => {
  if (registry[key]) await registry[key].waitReady;
}, 30_000);

afterAll(async () => {
  const database = registry[key];

  if (!database) return;
  await database.waitReady;
  // Database-owning suites close their fixture themselves. These setup hooks run
  // before root suite cleanup hooks, so closing here would invalidate that cleanup.
}, 30_000);
