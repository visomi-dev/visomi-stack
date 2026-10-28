import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { sessionStore } from '../../../tests/support/injection';

describe('PostgreSQL session adapter', () => {
  it('supports fire-and-forget destruction and suppresses the store diagnostic callback', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const store = sessionStore({ query } as unknown as Pool);

    store.destroy('synthetic-sid');
    await vi.waitFor(() => expect(query).toHaveResolved());
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      // Exercise the store's diagnostic hook without connecting to or deleting database rows.
      query.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_SQL'));
      store.pruneSessions();
      await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
      expect(diagnostic).not.toHaveBeenCalled();
    } finally {
      diagnostic.mockRestore();
    }
  });
  it('uses the supplied pool without probing, migrating, pruning or taking ownership', () => {
    const pool = { query: vi.fn(), end: vi.fn() } as unknown as Pool;
    const store = sessionStore(pool);

    store.close();
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.end).not.toHaveBeenCalled();
  });

  it('turns destruction into a durable tombstone, including an unknown SID', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const store = sessionStore({ query } as unknown as Pool);
    const error = await new Promise<Error | undefined>((resolve) => store.destroy('synthetic-sid', resolve));

    expect(error).toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), ['synthetic-sid']);
  });

  it('rejects regeneration from an already revoked SID', async () => {
    const store = sessionStore({ query: vi.fn().mockResolvedValue({ rowCount: 0 }) } as unknown as Pool);
    const error = await new Promise<Error | undefined>((resolve) => store.destroy('synthetic-sid', resolve));

    expect(error?.message).toBe('session_revoked');
  });

  it('does not return parameter-bearing database failures to callbacks', async () => {
    const store = sessionStore({
      query: vi.fn().mockRejectedValue(new Error('SYNTHETIC_PRIVATE_SQL')),
    } as unknown as Pool);
    const error = await new Promise<Error | undefined>((resolve) => store.destroy('synthetic-sid', resolve));

    expect(error?.message).toBe('session_store_unavailable');
  });
});
