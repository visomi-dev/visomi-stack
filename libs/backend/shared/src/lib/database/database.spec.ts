import { describe, expect, it, vi } from 'vitest';

import { createDatabase } from './database';

describe('explicit PostgreSQL ownership', () => {
  it('constructs a lazy pool without connecting and closes it exactly once', async () => {
    const resource = createDatabase('postgresql://synthetic@127.0.0.1:1/unused');
    const end = vi.spyOn(resource.pool, 'end');
    const first = resource.close();

    expect(resource.pool.totalCount).toBe(0);
    expect(() => resource.pool.emit('error', new Error('SYNTHETIC_IDLE_FAILURE'))).not.toThrow();
    expect(resource.close()).toBe(first);

    await first;

    expect(end).toHaveBeenCalledOnce();
  });

  it('reports an idle failure without exposing the raw error', async () => {
    const onError = vi.fn();
    const resource = createDatabase('postgresql://synthetic@127.0.0.1:1/unused', onError);

    resource.pool.emit('error', new Error('SYNTHETIC_PRIVATE_ERROR'));
    expect(onError).toHaveBeenCalledExactlyOnceWith();

    await resource.close();
  });

  it('keeps separately owned database resources independent', async () => {
    const first = createDatabase('postgresql://synthetic@127.0.0.1:1/unused');
    const second = createDatabase('postgresql://synthetic@127.0.0.1:1/unused');
    const endSecond = vi.spyOn(second.pool, 'end');

    try {
      expect(first.pool).not.toBe(second.pool);
      expect(first.db).not.toBe(second.db);

      await first.close();

      expect(endSecond).not.toHaveBeenCalled();
      expect(second.pool.ending).toBe(false);
      expect(second.pool.totalCount).toBe(0);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it('rejects non-PostgreSQL connection configuration before pool construction', () => {
    expect(() => createDatabase('https://example.invalid')).toThrow('database_configuration_invalid');
    expect(() => createDatabase('SYNTHETIC_PRIVATE_URL')).toThrow('database_configuration_invalid');
  });
});
