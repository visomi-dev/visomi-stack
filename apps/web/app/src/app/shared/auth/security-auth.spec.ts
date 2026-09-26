import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SecurityAuth } from './security-auth';

describe('SecurityAuth', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SecurityAuth, provideHttpClient(), provideHttpClientTesting()] });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('completes a typed reauthentication and regenerates recovery codes', async () => {
    const security = TestBed.inject(SecurityAuth);
    const http = TestBed.inject(HttpTestingController);
    const start = security.startReauthentication('recovery_codes_regenerate');

    http.expectOne('/api/auth/reauth/start').flush({
      data: { grantId: 'grant-1', methods: ['passkey'] },
      message: 'Reauthentication started.',
    });
    await expect(start).resolves.toEqual({ grantId: 'grant-1', methods: ['passkey'] });

    const complete = security.completeReauthentication({ grantId: 'grant-1', method: 'passkey' });

    http.expectOne('/api/auth/reauth/complete').flush({
      data: { grantId: 'grant-1', authenticated: true },
      message: 'Reauthentication completed.',
    });
    await complete;

    const regenerate = security.regenerateRecoveryCodes('grant-1');

    http.expectOne('/api/auth/recovery-codes/regenerate').flush({
      data: { recoveryCodes: ['ABCD-1234'] },
      message: 'Recovery codes regenerated.',
    });
    await expect(regenerate).resolves.toEqual(['ABCD-1234']);
  });
});
