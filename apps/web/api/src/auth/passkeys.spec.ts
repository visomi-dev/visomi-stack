import type { Database } from '@visomi-stack/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { authConfig } from './config';
import { Passkeys } from './passkeys';

const config = authConfig({
  origin: 'http://localhost',
  rpId: 'localhost',
  secret: 'synthetic-session-secret-with-32-bytes',
});

describe('passkey capability authorization', () => {
  it('requires fresh passkey authentication before offering enrollment or changing credentials', async () => {
    const database = { transaction: vi.fn(), select: vi.fn(), update: vi.fn() } as unknown as Database;
    const passkeys = new Passkeys(database, config);
    const stale = { id: 'synthetic-user', credentialId: 'synthetic-credential', authenticatedAt: Date.now() - 600000 };

    await expect(passkeys.registrationOptions('synthetic-session', stale)).rejects.toMatchObject({
      code: 'reauthentication_required',
    });
    await expect(passkeys.rename('synthetic-session', stale, 'credential', 'label')).rejects.toMatchObject({
      code: 'reauthentication_required',
    });
    await expect(passkeys.revoke('synthetic-session', stale, 'credential')).rejects.toMatchObject({
      code: 'reauthentication_required',
    });
    expect(database.transaction).not.toHaveBeenCalled();
    expect(database.select).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
  });
});
