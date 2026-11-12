import { describe, expect, it } from 'vitest';

import { passkeyProviderName } from './provider-name';

describe('passkey provider display hints', () => {
  it('recognizes a known AAGUID independently of its casing', () => {
    const aaguid = 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4';

    expect(passkeyProviderName(aaguid)).toBe('Google Password Manager');
    expect(passkeyProviderName(aaguid.toUpperCase())).toBe('Google Password Manager');
  });

  it.each([null, '', '00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'toString'])(
    'does not invent a provider for unavailable metadata (%s)',
    (aaguid) => expect(passkeyProviderName(aaguid)).toBeNull(),
  );
});
