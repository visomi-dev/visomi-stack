import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { Auth } from '../shared/auth/auth';
import { SecurityAction } from '../shared/auth/security-action';
import { Passkey, type PasskeyCredential } from '../shared/auth/passkey';

import { Security } from './security';

const activePasskey: PasskeyCredential = {
  id: 'active-passkey',
  label: 'Existing laptop',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  transports: ['internal'],
  backupEligible: false,
  backupState: false,
};

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
      listCredentials: vi.fn(async () => [activePasskey]),
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
        SecurityAction,
      ],
    });
    const security = TestBed.runInInjectionContext(() => new Security());

    await Promise.resolve();
    calls.length = 0;
    security.nameModel.set({ name: 'Backup key' });
    const pending = security.addPasskey();

    expect(passkey.beginAuthentication).not.toHaveBeenCalled();
    await TestBed.inject(SecurityAction).confirm('passkey');
    await pending;

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
    expect(passkey.listCredentials).toHaveBeenCalledTimes(2);
    expect(security.view()).toBe('list');
  });

  it('does not register a first passkey before enrollment is authorized', async () => {
    const beginRegistration = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        { provide: Passkey, useValue: { listCredentials: vi.fn(async () => []), beginRegistration } },
        { provide: Auth, useValue: {} },
        { provide: HttpClient, useValue: { get: vi.fn(() => of({ data: null })) } },
        SecurityAction,
      ],
    });
    const security = TestBed.runInInjectionContext(() => new Security());

    await Promise.resolve();
    security.showAdd();
    security.nameModel.set({ name: 'First laptop' });
    await security.addPasskey();

    expect(beginRegistration).not.toHaveBeenCalled();
    expect(security.enrollmentAuthorized()).toBe(false);
    expect(security.view()).toBe('add');
    expect(security.passkeySubmitting()).toBe(false);
  });

  it('clears first-enrollment proof and authorization when the user cancels', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: Passkey, useValue: { listCredentials: vi.fn(async () => []) } },
        { provide: Auth, useValue: {} },
        { provide: HttpClient, useValue: { get: vi.fn(() => of({ data: null })) } },
        SecurityAction,
      ],
    });
    const security = TestBed.runInInjectionContext(() => new Security());

    await Promise.resolve();
    security.showAdd();
    security.firstPasskeyFlow.set({
      flowId: 'first-enrollment-flow',
      requiredFactor: 'email',
      expiresAt: '2026-01-01T00:05:00.000Z',
    });
    security.enrollmentAuthorized.set(true);
    security.enrollmentModel.set({ password: 'private-password', code: '123456' });
    security.cancelPasskeyAction();

    expect(security.enrollmentAuthorized()).toBe(false);
    expect(security.firstPasskeyFlow()).toBeNull();
    expect(security.enrollmentModel()).toEqual({ password: '', code: '' });
    expect(security.view()).toBe('list');
  });
});
