import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { UnlockCapabilities } from './unlock-capabilities';

afterEach(() => TestBed.resetTestingModule());

it.each([
  { credentials: undefined, capability: undefined, expected: 'unavailable' },
  { credentials: { create: vi.fn(), get: vi.fn() }, capability: { 'extension:prf': true }, expected: 'available' },
  { credentials: { create: vi.fn(), get: vi.fn() }, capability: { 'extension:prf': false }, expected: 'unavailable' },
  { credentials: { create: vi.fn(), get: vi.fn() }, capability: {}, expected: 'unavailable' },
  { credentials: { create: vi.fn(), get: vi.fn() }, capability: undefined, expected: 'unknown' },
])('detects PRF support without a credential ceremony: $expected', async ({ credentials, capability, expected }) => {
  const create = vi.fn();
  const probe = capability ? vi.fn(async () => capability) : undefined;

  TestBed.configureTestingModule({
    providers: [
      {
        provide: DOCUMENT,
        useValue: {
          defaultView: {
            navigator: { credentials: credentials ? { ...credentials, create } : undefined },
            PublicKeyCredential: { getClientCapabilities: probe },
          },
        },
      },
    ],
  });
  const support = TestBed.inject(UnlockCapabilities);

  expect(support.prf()).toBe('checking');
  TestBed.tick();

  await vi.waitFor(() => expect(support.prf()).toBe(expected));

  expect(create).not.toHaveBeenCalled();
});

it('does not label a rejected capability probe as an unsupported authenticator', async () => {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: DOCUMENT,
        useValue: {
          defaultView: {
            navigator: { credentials: { create: vi.fn(), get: vi.fn() } },
            PublicKeyCredential: {
              getClientCapabilities: async () => {
                throw new Error('synthetic-probe-failure');
              },
            },
          },
        },
      },
    ],
  });
  const support = TestBed.inject(UnlockCapabilities);

  TestBed.tick();

  await vi.waitFor(() => expect(support.prf()).toBe('unknown'));

  support.unavailable();
  expect(support.prf()).toBe('unavailable');
});
