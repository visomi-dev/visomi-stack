import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { Passkey } from './passkey';

describe('Passkey browser discovery', () => {
  function configure(defaultView: unknown): Passkey {
    TestBed.configureTestingModule({
      providers: [Passkey, { provide: DOCUMENT, useValue: { defaultView } }, { provide: HttpClient, useValue: {} }],
    });

    return TestBed.inject(Passkey);
  }

  it('does not access browser credentials during server rendering', async () => {
    const passkey = configure(null);

    expect(passkey.isSupported()).toBe(false);
    expect(await passkey.supportsConditionalAuthentication()).toBe(false);
    expect(await passkey.supportsImmediateAuthentication()).toBe(false);
  });

  it('uses immediate UI without a credential allowlist or abort signal', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'credential' });
    const passkey = configure({ navigator: { credentials: { get } } });

    await passkey.getImmediateCredential({ challenge: 'AQID', allowCredentials: [{ id: 'AQID' }] });
    const options = get.mock.calls[0][0];

    expect(options.uiMode).toBe('immediate');
    expect(options.publicKey.allowCredentials).toEqual([]);
    expect(options).not.toHaveProperty('signal');
    expect(options).not.toHaveProperty('mediation');
  });

  it('requires an explicit immediate capability, not platform availability', async () => {
    const passkey = configure({
      isSecureContext: true,
      navigator: { credentials: {} },
      PublicKeyCredential: { getClientCapabilities: async () => ({ passkeyPlatformAuthenticator: true }) },
    });

    expect(await passkey.supportsImmediateAuthentication()).toBe(false);
  });

  it('accepts conditional support without requiring a platform authenticator', async () => {
    const passkey = configure({
      isSecureContext: true,
      navigator: { credentials: {} },
      PublicKeyCredential: {
        getClientCapabilities: async () => ({ conditionalGet: true, userVerifyingPlatformAuthenticator: false }),
      },
    });

    expect(await passkey.supportsConditionalAuthentication()).toBe(true);
  });

  it('falls back to the conditional mediation probe on older browsers', async () => {
    const passkey = configure({
      isSecureContext: true,
      navigator: { credentials: {} },
      PublicKeyCredential: { isConditionalMediationAvailable: async () => true },
    });

    expect(await passkey.supportsConditionalAuthentication()).toBe(true);
  });

  it('keeps explicit passkey access when capability detection fails', async () => {
    const passkey = configure({
      isSecureContext: true,
      navigator: { credentials: {} },
      PublicKeyCredential: {
        getClientCapabilities: async () => {
          throw new Error('Unavailable');
        },
      },
    });

    expect(passkey.isSupported()).toBe(true);
    expect(await passkey.supportsConditionalAuthentication()).toBe(false);
  });

  it('passes cancellation ownership and conditional mediation to the browser', async () => {
    const credential = { id: 'credential' };
    const get = vi.fn().mockResolvedValue(credential);
    const passkey = configure({ navigator: { credentials: { get } } });
    const controller = new AbortController();

    expect(
      await passkey.getCredential({ challenge: 'AQID' }, { mediation: 'conditional', signal: controller.signal }),
    ).toBe(credential);
    expect(get).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({ challenge: new Uint8Array([1, 2, 3]).buffer }),
      mediation: 'conditional',
      signal: controller.signal,
    });
  });
});
