import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import * as webauthn from '@simplewebauthn/browser';

import { Session } from '../session/session';
import { AuthHttp } from '../shared/http';

import { Passkeys } from './passkeys';

// Another page may have loaded the adapter in this shared test worker before its SDK mock.
vi.hoisted(() => {
  vi.resetModules();
});
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: () => true,
  browserSupportsWebAuthnAutofill: async () => true,
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));
afterEach(() => vi.clearAllMocks());
it('does not submit an abandoned passkey registration to the backend', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof webauthn.startRegistration>>) => void;

  vi.mocked(webauthn.startRegistration).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const request = vi
    .fn()
    .mockResolvedValue({ challengeId: 'synthetic-challenge', options: { challenge: 'synthetic-options' } });

  TestBed.configureTestingModule({
    providers: [
      { provide: Session, useValue: { cancelled: NEVER } },
      Passkeys,
      { provide: AuthHttp, useValue: { request } },
    ],
  });
  const api = TestBed.inject(Passkeys);
  const operation = api.register('demo@example.test');
  const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' });

  await vi.waitFor(() => expect(webauthn.startRegistration).toHaveBeenCalledOnce());

  api.cancel();
  resolve({} as Awaited<ReturnType<typeof webauthn.startRegistration>>);

  await rejected;

  expect(request).toHaveBeenCalledTimes(1);
});
it('cancels conditional autofill before another authentication can complete', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof webauthn.startAuthentication>>) => void;

  vi.mocked(webauthn.startAuthentication).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const request = vi
    .fn()
    .mockResolvedValue({ challengeId: 'synthetic-challenge', options: { challenge: 'synthetic-options' } });

  TestBed.configureTestingModule({
    providers: [
      { provide: Session, useValue: { cancelled: NEVER } },
      Passkeys,
      { provide: AuthHttp, useValue: { request } },
    ],
  });
  const api = TestBed.inject(Passkeys);
  const operation = api.authenticate(true);
  const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' });

  await vi.waitFor(() => expect(webauthn.startAuthentication).toHaveBeenCalledOnce());

  api.cancel();
  resolve({} as Awaited<ReturnType<typeof webauthn.startAuthentication>>);

  await rejected;

  expect(request).toHaveBeenCalledTimes(1);
});
