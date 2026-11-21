import { expect, it, vi } from 'vitest';
import { wrappingContextSchema } from '@visomi-stack/shared-db';

import { PrfUnlock } from './prf';
import { createPrfCredential } from './prf-credential';

const binding = wrappingContextSchema.parse({
  key: {
    product: 'synthetic-example',
    domain: 'private-resources',
    scope: {
      kind: 'resource',
      tenantId: '11111111-1111-4111-8111-111111111111',
      groupId: null,
      resourceId: '22222222-2222-4222-8222-222222222222',
    },
    generation: 1,
  },
  ownerId: '33333333-3333-4333-8333-333333333333',
  deviceId: '44444444-4444-4444-8444-444444444444',
  method: 'passkey-prf',
  methodId: 'AQ',
  origin: 'https://synthetic.example.test',
});

it.each([
  { name: 'AbortError', code: 'cancelled' },
  { name: 'NotAllowedError', code: 'cancelled' },
  { name: 'NotSupportedError', code: 'unavailable' },
  { name: 'UnknownError', code: 'unavailable' },
])('reports $name during local PRF ceremonies as $code', async ({ name, code }) => {
  const fail = vi.fn().mockRejectedValue(new DOMException('Synthetic failure', name));
  const environment = {
    origin: binding.origin,
    rpId: 'synthetic.example.test',
    credentials: { create: fail, get: fail, preventSilentAccess: vi.fn(), store: vi.fn() },
    crypto: globalThis.crypto,
  };

  await expect(createPrfCredential(environment, new AbortController().signal)).rejects.toMatchObject({ code });

  await expect(new PrfUnlock(environment).secret(binding)).rejects.toMatchObject({ code });
});

it.each([true, false])(
  'keeps resource and device PRF outputs bound to their original salts (dual output %s)',
  async (dual) => {
    const { deviceCustodyContext } = await import('./device-custody');
    const { encodeBytes } = await import('../crypto/cipher');
    const rpId = 'synthetic.example.test';
    const encoder = new TextEncoder();
    const salts: string[][] = [];
    const get = vi.fn(async (request: CredentialRequestOptions) => {
      const options = request.publicKey!;
      const evaluation = options.extensions!.prf!.eval!;
      const inputs = [evaluation.first, evaluation.second].filter((value) => value !== undefined);

      salts.push(inputs.map((input) => encodeBytes(new Uint8Array(input as ArrayBuffer))));
      const auth = new Uint8Array(37);
      const hash = await crypto.subtle.digest('SHA-256', encoder.encode(rpId));

      auth.set(new Uint8Array(hash));
      auth[32] = 5;

      return {
        id: 'AQ',
        rawId: Uint8Array.of(1).buffer,
        type: 'public-key',
        response: {
          authenticatorData: auth.buffer,
          clientDataJSON: encoder.encode(
            JSON.stringify({
              type: 'webauthn.get',
              challenge: encodeBytes(new Uint8Array(options.challenge as ArrayBuffer)),
              origin: binding.origin,
            }),
          ),
        },
        getClientExtensionResults: () => ({
          prf: {
            results: {
              first: new Uint8Array(32).fill(salts.length === 1 ? 1 : 2),
              ...(dual && { second: new Uint8Array(32).fill(2) }),
            },
          },
        }),
      };
    });
    const provider = new PrfUnlock({
      origin: binding.origin,
      rpId,
      credentials: { get } as unknown as CredentialsContainer,
      crypto,
    });
    const cancel = new AbortController();
    const method = await provider.forDevice(binding, cancel.signal);
    const device = deviceCustodyContext(binding);

    await expect(method.secret({ ...binding, origin: 'https://other.example.test' })).rejects.toMatchObject({
      code: 'stale-operation',
    });

    await expect(method.secret(binding)).resolves.toEqual(new Uint8Array(32).fill(1));

    await expect(method.secret(binding)).rejects.toMatchObject({ code: 'stale-operation' });

    await expect(method.secret(device)).resolves.toEqual(new Uint8Array(32).fill(2));

    expect(salts[0][0]).not.toBe(salts[0][1]);
    expect(get).toHaveBeenCalledTimes(dual ? 1 : 2);

    if (!dual) {
      expect(salts[1]).toEqual([salts[0][1]]);
    }

    method.cancel();
    const interrupted = await provider.forDevice(binding, cancel.signal);

    cancel.abort();

    await expect(interrupted.secret(binding)).rejects.toMatchObject({ code: 'stale-operation' });

    interrupted.cancel();
  },
);
