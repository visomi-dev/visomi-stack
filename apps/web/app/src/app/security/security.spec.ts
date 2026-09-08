import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { Auth } from '../shared/auth/auth';
import { DeviceApproval } from '../shared/auth/device-approval';
import { Passkey } from '../shared/auth/passkey';

import { Security } from './security';

describe('Security', () => {
  it('reauthenticates, registers, and asserts the new passkey before listing it', async () => {
    const calls: string[] = [];
    const passkey = {
      beginAuthentication: vi.fn(async () => {
        calls.push('reauthenticate');

        return { challengeId: 'active-challenge', options: { challenge: 'active-options' } };
      }),
      getCredential: vi.fn(async (options: Record<string, unknown>) => {
        calls.push(options['challenge'] === 'active-options' ? 'assert-active' : 'assert-new');

        return {} as Credential;
      }),
      completeAuthentication: vi.fn(async () => {
        calls.push('complete-reauthentication');
      }),
      beginRegistration: vi.fn(async () => {
        calls.push('begin-registration');

        return { challengeId: 'registration-challenge', options: {} };
      }),
      createCredential: vi.fn(async () => {
        calls.push('create-credential');

        return {} as Credential;
      }),
      completeRegistration: vi.fn(async () => {
        calls.push('complete-registration');

        return {
          restrictedSession: {
            verificationChallengeId: 'verification-challenge',
            verificationOptions: { challenge: 'new-options' },
          },
        };
      }),
      verifyRegistration: vi.fn(async () => {
        calls.push('verify-registration');
      }),
      listCredentials: vi.fn(async () => []),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: Passkey, useValue: passkey },
        {
          provide: Auth,
          useValue: {
            ensureSessionLoaded: vi.fn(async () => undefined),
            user: () => ({ accountId: 'account-1', id: 'user-1' }),
          },
        },
        { provide: HttpClient, useValue: { get: vi.fn(() => of({ data: null })) } },
        { provide: DeviceApproval, useValue: {} },
      ],
    });
    const security = TestBed.runInInjectionContext(() => new Security());

    await Promise.resolve();
    calls.length = 0;
    security.passkeyName.set('Backup key');
    await security.addPasskey();

    expect(calls).toEqual([
      'reauthenticate',
      'assert-active',
      'complete-reauthentication',
      'begin-registration',
      'create-credential',
      'complete-registration',
      'assert-new',
      'verify-registration',
    ]);
  });
});
