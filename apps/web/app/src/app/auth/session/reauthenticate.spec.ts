import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Action } from '../shared/action';
import { Google } from '../google/google';
import { Passwords } from '../password/passwords';
import { Passkeys } from '../passkeys/passkeys';
import { AuthNavigation } from '../shared/navigation';
import { Journey } from '../shared/journey';

import { Reauthenticate } from './reauthenticate';
import { Session } from './session';
import { Methods } from './methods';

const pending = { flowId: 'synthetic-google-reauth', expiresAt: '2099-01-01T00:00:00Z', factor: 'email' as const };
const verifyGoogle = vi.fn();
const verifyPassword = vi.fn();
const complete = vi.fn();

beforeEach(() => {
  verifyGoogle.mockReset().mockResolvedValue(undefined);
  verifyPassword.mockReset().mockResolvedValue(undefined);
  complete.mockReset().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      Journey,
      { provide: Session, useValue: { full: () => true, loadProviders: async () => undefined } },
      { provide: AuthNavigation, useValue: { complete, returnPath: () => '/security/password' } },
    ],
  });
  TestBed.overrideComponent(Reauthenticate, {
    set: {
      providers: [
        Action,
        { provide: Google, useValue: { verify: verifyGoogle } },
        { provide: Passwords, useValue: { completeReauth: verifyPassword } },
        { provide: Passkeys, useValue: {} },
        { provide: Methods, useValue: { list: async () => ({ google: [], passkeys: [], password: false }) } },
      ],
    },
  });
});

it('keeps a Google email challenge and verifies it before completing reauthentication', async () => {
  const fixture = TestBed.createComponent(Reauthenticate);
  const page = fixture.componentInstance;
  const journey = TestBed.inject(Journey);

  await fixture.whenStable();

  page.google(pending);

  await fixture.whenStable();

  expect(page.pending()).toEqual({ ...pending, method: 'google' });
  expect(journey.challenge()).toMatchObject({ ...pending, purpose: 'google' });
  expect(fixture.nativeElement.querySelector('app-code-entry')).not.toBeNull();
  expect(fixture.nativeElement.textContent).toContain('Verify your email to finish continuing with Google.');
  expect(complete).not.toHaveBeenCalled();
  page.verify('001234');

  await fixture.whenStable();

  expect(verifyGoogle).toHaveBeenCalledExactlyOnceWith(pending.flowId, '001234');
  expect(verifyPassword).not.toHaveBeenCalled();
  expect(journey.challenge()).toBeNull();
  expect(complete).toHaveBeenCalledOnce();
});

it('keeps failed Google verification available for correction without granting recent proof', async () => {
  verifyGoogle.mockRejectedValueOnce(new HttpErrorResponse({ status: 400, error: { error: 'verification_failed' } }));
  const fixture = TestBed.createComponent(Reauthenticate);
  const page = fixture.componentInstance;

  await fixture.whenStable();

  page.google(pending);
  page.verify('001234');

  await fixture.whenStable();

  expect(complete).not.toHaveBeenCalled();
  expect(page.pending()).toMatchObject({ flowId: pending.flowId, method: 'google' });
  expect(page.action.error()).toContain('We could not verify these details.');
  page.verify('005678');

  await fixture.whenStable();

  expect(verifyGoogle).toHaveBeenLastCalledWith(pending.flowId, '005678');
  expect(complete).toHaveBeenCalledOnce();
});

it('still verifies password factors through the password endpoint', async () => {
  const fixture = TestBed.createComponent(Reauthenticate);
  const page = fixture.componentInstance;

  await fixture.whenStable();

  page.pending.set({ ...pending, method: 'password', factor: 'totp' });
  page.backup.set(true);
  page.verify('SYNTHETIC-BACKUP');

  await fixture.whenStable();

  expect(verifyPassword).toHaveBeenCalledExactlyOnceWith(pending.flowId, {
    kind: 'recovery_code',
    code: 'SYNTHETIC-BACKUP',
  });
  expect(verifyGoogle).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledOnce();
});
