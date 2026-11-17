import { webcrypto } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { provisionDeviceIdentity, restoreDeviceIdentity } from './identity-custody';
import { WebCryptoDevices } from './devices';

const crypto = webcrypto as unknown as Crypto;
const devices = new WebCryptoDevices(crypto);

describe('device private key custody', () => {
  it('protects provisioning bytes once, clears them and restores nonextractable operational keys', async () => {
    let transient: Uint8Array = new Uint8Array();
    let backup: Uint8Array = new Uint8Array();
    const first = await provisionDeviceIdentity(crypto, async (material) => {
      transient = material;
      backup = Uint8Array.from(material);
    });

    expect(transient.every((value) => value === 0)).toBe(true);
    const restored = await restoreDeviceIdentity(crypto, backup);
    const firstKeys = await devices.publicKeys(first);
    const restoredKeys = await devices.publicKeys(restored);

    expect(restoredKeys).toEqual(firstKeys);
    expect(restored.signing.privateKey.extractable).toBe(false);
    expect(restored.encryption.privateKey.extractable).toBe(false);
    backup.fill(0);
  });

  it('clears transient private material if encryption or local commit fails', async () => {
    let transient: Uint8Array = new Uint8Array();

    await expect(
      provisionDeviceIdentity(crypto, async (material) => {
        transient = material;

        throw new Error('synthetic_storage_failure');
      }),
    ).rejects.toThrow('synthetic_storage_failure');

    expect(transient.length).toBeGreaterThan(1000);
    expect(transient.every((value) => value === 0)).toBe(true);
  });

  it.each([new Uint8Array(), new Uint8Array(8193), new Uint8Array(20), new Uint8Array([0, 0, 0, 2])])(
    'rejects malformed or unsupported private material',
    async (material) => {
      await expect(restoreDeviceIdentity(crypto, material)).rejects.toMatchObject({ code: 'key-invalid' });
    },
  );
});
