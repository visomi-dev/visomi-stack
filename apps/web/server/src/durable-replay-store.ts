import { getPool } from 'shared';

type DurableReplayStoreOptions = { tableName?: string };

class DurableReplayStore {
  private readonly tableName: string;
  private ready: Promise<void> | undefined;
  private readonly fallback = new Set<string>();

  constructor(options: DurableReplayStoreOptions = {}) {
    this.tableName = options.tableName ?? 'themis_handshake_replays';
  }

  async claim(key: string): Promise<boolean> {
    if (process.env.DATABASE_DRIVER !== 'pg') {
      if (this.fallback.has(key)) return false;
      this.fallback.add(key);

      return true;
    }

    this.ready ??= this.ensureTable();
    await this.ready;
    const result = await getPool().query(
      `INSERT INTO ${this.tableName} (replay_key, claimed_at) VALUES ($1, NOW()) ON CONFLICT (replay_key) DO NOTHING`,
      [key],
    );

    return result.rowCount === 1;
  }

  private async ensureTable(): Promise<void> {
    await getPool().query(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (replay_key TEXT PRIMARY KEY, claimed_at TIMESTAMPTZ NOT NULL)`,
    );
  }
}

export { DurableReplayStore };
