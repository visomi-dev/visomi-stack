import { describe, expect, it, vi } from 'vitest';
import { VaultError, type WrappingContext } from '@visomi-stack/shared-db';

import type { ClientDatabase } from './database';
import type { VaultSession } from './vault-session';
import { openLocalPin } from './local-pin';

const target = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  scopeId: '22222222-2222-4222-8222-222222222222',
  objectId: '33333333-3333-4333-8333-333333333333',
};
const binding: WrappingContext = {
  key: {
    product: 'synthetic-example',
    domain: 'private-resources',
    scope: { kind: 'resource', tenantId: target.tenantId, groupId: null, resourceId: target.scopeId },
    generation: 2,
  },
  ownerId: '44444444-4444-4444-8444-444444444444',
  deviceId: '55555555-5555-4555-8555-555555555555',
  method: 'pin-argon2id',
  methodId: 'A'.repeat(43),
  origin: 'https://synthetic.example.test',
};

function fixture() {
  const controller = new AbortController();
  const custody = { lock: vi.fn() };
  const storage = {
    close: vi.fn(),
    pin: vi.fn(async () => ({ cursor: 8, checkpoint: 'synthetic-checkpoint', generation: 2, epoch: 3 })),
  };
  const vault = {
    localLatestBinding: vi.fn(async () => binding),
    connect: vi.fn(async () => undefined),
    device: vi.fn(async () => custody),
    lock: vi.fn(),
  };
  const database = { replica: vi.fn(async () => storage) };
  const options = {
    vault: vault as unknown as VaultSession,
    database: database as unknown as ClientDatabase,
    target,
    rpId: 'synthetic.example.test',
    pin: new TextEncoder().encode('012345'),
    ownerId: binding.ownerId,
    signal: controller.signal,
    current: () => {
      if (controller.signal.aborted) {
        throw new VaultError('stale-operation');
      }
    },
  };

  return { options, controller, vault, database, custody, storage };
}

describe('local PIN connection ownership and rollback boundary', () => {
  it('opens local custody without a transport or a WebAuthn dependency and transfers the persisted pins intact', async () => {
    const f = fixture();
    const result = await openLocalPin(f.options);

    expect(f.vault.connect).toHaveBeenCalledWith(binding, f.options.rpId, false, f.options.pin);
    expect(result.pinned).toEqual({ cursor: 8, checkpoint: 'synthetic-checkpoint', generation: 2, epoch: 3 });
    expect(result.storage).toBe(f.storage);
    expect(f.storage.close).not.toHaveBeenCalled();
  });

  it('rejects a local key older than the retained generation pin without clearing ciphertext or checkpoints', async () => {
    const f = fixture();

    f.storage.pin.mockResolvedValueOnce({ cursor: 8, checkpoint: 'synthetic-checkpoint', generation: 3, epoch: 3 });

    await expect(openLocalPin(f.options)).rejects.toMatchObject({ code: 'corrupt' });

    expect(f.storage.close).toHaveBeenCalledOnce();
    expect(f.custody.lock).toHaveBeenCalledOnce();
    expect(f.vault.lock).toHaveBeenCalledWith(false);
  });

  it('closes a late connection after cancellation without locking a newer selected vault', async () => {
    const f = fixture();

    f.database.replica.mockImplementationOnce(async () => {
      f.controller.abort();

      return f.storage;
    });

    await expect(openLocalPin(f.options)).rejects.toMatchObject({ code: 'stale-operation' });

    expect(f.storage.close).toHaveBeenCalledOnce();
    expect(f.vault.lock).not.toHaveBeenCalled();
  });

  it('locks the unlocked resource if signing custody cannot be restored', async () => {
    const f = fixture();

    f.vault.device.mockRejectedValueOnce(new VaultError('corrupt'));

    await expect(openLocalPin(f.options)).rejects.toMatchObject({ code: 'corrupt' });

    expect(f.database.replica).not.toHaveBeenCalled();
    expect(f.vault.lock).toHaveBeenCalledWith(false);
  });

  it('does not reinterpret a PRF binding as PIN fallback', async () => {
    const f = fixture();

    f.vault.localLatestBinding.mockResolvedValueOnce({ ...binding, method: 'passkey-prf' });

    await expect(openLocalPin(f.options)).rejects.toMatchObject({ code: 'recovery-required' });

    expect(f.vault.connect).not.toHaveBeenCalled();
  });
});
