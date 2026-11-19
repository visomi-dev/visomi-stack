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
