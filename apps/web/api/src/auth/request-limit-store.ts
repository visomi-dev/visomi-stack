import { DATABASE, inject, type Database } from '@visomi-stack/backend-shared';
import { sql } from 'drizzle-orm';
import type { Store } from 'express-rate-limit';

export class RequestLimitStore implements Store {
  private readonly database = inject<Database>(DATABASE);

  async increment(key: string) {
    const result = await this.database.execute<{ attempts: number; expiresAt: Date }>(sql`
      INSERT INTO auth_rate_limits (key, attempts, expires_at)
      VALUES (${key}, 1, now() + interval '1 minute')
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.expires_at <= now() THEN 1
          ELSE LEAST(auth_rate_limits.attempts + 1, 10001) END,
        expires_at = CASE WHEN auth_rate_limits.expires_at <= now() THEN now() + interval '1 minute'
          ELSE auth_rate_limits.expires_at END
      RETURNING attempts, expires_at AS "expiresAt"`);
    const { attempts, expiresAt } = result.rows[0];

    return { totalHits: attempts, resetTime: expiresAt };
  }

  // The HTTP limiters count every request and expose no counter-reset endpoint.
  // Reject these optional operations rather than weakening shared counters.
  decrement(): never {
    throw new Error('rate_limit_decrement_disabled');
  }

  resetKey(): never {
    throw new Error('rate_limit_reset_disabled');
  }
}
