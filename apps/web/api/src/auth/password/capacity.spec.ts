import { describe, expect, it, vi } from 'vitest';

import { hashPassword, verifyPassword } from './crypto';

const boundary = vi.hoisted(() => ({ derive: vi.fn() }));

vi.mock('hash-wasm', () => ({ argon2id: boundary.derive }));

describe('password derivation memory budget', () => {
  it('bounds concurrent hashing and verification and releases capacity after failures', async () => {
    let finish: (value: string) => void;

    boundary.derive.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const pending = Array.from({ length: 4 }, () => hashPassword('Synthetic password 42!'));

    await expect(hashPassword('Synthetic password 42!')).rejects.toMatchObject({
      status: 429,
      code: 'password_capacity',
    });
    await expect(verifyPassword('Synthetic password 42!', 'malformed')).rejects.toMatchObject({
      code: 'password_capacity',
    });
    finish!('00'.repeat(32));
    await Promise.all(pending);
    boundary.derive.mockRejectedValueOnce(new Error('synthetic_kdf_failure'));
    await expect(hashPassword('Synthetic password 42!')).rejects.toThrow('synthetic_kdf_failure');
    boundary.derive.mockResolvedValue('00'.repeat(32));
    await expect(hashPassword('Synthetic password 42!')).resolves.toMatch(/^\$argon2id\$/);
  });
});
