import { expect, test } from '@playwright/test';

test('ships an isolated Argon2 worker with non-extractable browser keys in both localized builds', async ({
  page,
  request,
}) => {
  for (const locale of ['en', 'es']) {
    const asset = await request.get(`/app/${locale}/vault-pin-worker.js`);

    expect(asset.ok()).toBe(true);
    expect(asset.headers()['content-type']).toContain('javascript');
    expect(asset.headers()['set-cookie']).toBeUndefined();
    expect(asset.headers()['content-security-policy']).toContain("'wasm-unsafe-eval'");
  }
  await page.goto('/app/en/sign-in');
  const pageResponse = await request.get('/app/en/sign-in');

  expect(pageResponse.headers()['content-security-policy']).not.toContain("'wasm-unsafe-eval'");
  const result = await page.evaluate(async () => {
    const worker = new Worker(new URL('vault-pin-worker.js', document.baseURI), { type: 'module' });
    const id = crypto.randomUUID();
    const encode = (length: number) =>
      btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(length))))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    const envelope = {
      version: 1,
      kdfProfile: 'pin-argon2id-hkdf-sha256-v1',
      binding: {
        ownerUserId: crypto.randomUUID(),
        personalScopeId: crypto.randomUUID(),
        methodId: crypto.randomUUID(),
        methodKind: 'local-pin',
        browserId: crypto.randomUUID(),
        keyGeneration: 1,
      },
      hkdfSalt: encode(32),
      argon2Salt: encode(16),
      iv: encode(12),
      ciphertext: encode(48),
    };

    try {
      const key = await new Promise<CryptoKey>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('Worker derivation timed out.')), 10_000);

        worker.onerror = () => {
          clearTimeout(deadline);
          reject(new Error('Worker failed.'));
        };
        worker.onmessage = ({ data }: MessageEvent<{ id?: string; key?: CryptoKey; error?: string }>) => {
          clearTimeout(deadline);
          if (data.id !== id || !(data.key instanceof CryptoKey))
            reject(
              new Error(
                data.error === 'pin_derivation_failed' ? 'Worker derivation failed.' : 'Invalid worker response.',
              ),
            );
          else resolve(data.key);
        };
        worker.postMessage({ id, pin: '592748', envelope });
      });
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode('Synthetic worker fixture');
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      let exportDenied = false;

      try {
        await crypto.subtle.exportKey('raw', key);
      } catch {
        exportDenied = true;
      }

      return {
        extractable: key.extractable,
        algorithm: key.algorithm.name,
        usages: [...key.usages].sort(),
        exportDenied,
        roundTrip: new TextDecoder().decode(decrypted) === 'Synthetic worker fixture',
      };
    } finally {
      worker.terminate();
    }
  });

  expect(result).toEqual({
    extractable: false,
    algorithm: 'AES-GCM',
    usages: ['decrypt', 'encrypt'],
    exportDenied: true,
    roundTrip: true,
  });
});
