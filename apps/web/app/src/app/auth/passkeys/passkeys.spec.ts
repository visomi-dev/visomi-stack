import { TestBed } from '@angular/core/testing';
import * as webauthn from '@simplewebauthn/browser';

import { Session } from '../session/session';
import { AuthHttp } from '../shared/http';

import { Passkeys } from './passkeys';

// Another page may have loaded the adapter in this shared test worker before its SDK mock.
vi.hoisted(() => {
  vi.resetModules();
});

vi.mock('@simplewebauthn/browser', () => ({
  bufferToBase64URLString: (buffer: ArrayBuffer) => Buffer.from(buffer).toString('base64url'),
  sendSignal: vi.fn().mockResolvedValue(undefined),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: () => true,
  browserSupportsWebAuthnAutofill: async () => true,
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});

it('cancels passkey registration immediately when the session changes', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof webauthn.startRegistration>>) => void;

  vi.mocked(webauthn.startRegistration).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const request = vi
    .fn()
    .mockResolvedValue({ challengeId: 'synthetic-challenge', options: { challenge: 'synthetic-options' } });
  const cancellation = new AbortController();

  TestBed.configureTestingModule({
    providers: [
      { provide: Session, useValue: { cancellation: () => cancellation.signal } },
      Passkeys,
      { provide: AuthHttp, useValue: { request } },
    ],
  });
  const api = TestBed.inject(Passkeys);
  const operation = api.register('demo@example.test');
  const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' });

  await vi.waitFor(() => expect(webauthn.startRegistration).toHaveBeenCalledOnce());

  vi.mocked(webauthn.WebAuthnAbortService.cancelCeremony).mockClear();
  cancellation.abort();
  expect(webauthn.WebAuthnAbortService.cancelCeremony).toHaveBeenCalledOnce();
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
      { provide: Session, useValue: { cancellation: () => new AbortController().signal } },
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

const account = { id: 'synthetic-owner', email: 'synthetic@example.test' };

function authenticationSession(access = 'full') {
  const request = vi.fn();

  vi.mocked(webauthn.startAuthentication).mockResolvedValue({} as never);
  vi.mocked(webauthn.sendSignal).mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      Passkeys,
      { provide: Session, useValue: { cancellation: () => new AbortController().signal } },
      { provide: AuthHttp, useValue: { request } },
    ],
  });
  const api = TestBed.inject(Passkeys);

  return async (user = account, rpId = 'localhost') => {
    const result = { access, user };

    request
      .mockResolvedValueOnce({ challengeId: 'synthetic-challenge', options: { rpId } })
      .mockResolvedValueOnce(result);

    await expect(api.authenticate()).resolves.toBe(result);
  };
}

it('updates a legacy label once per account and relying party and updates it again when the email changes', async () => {
  const authenticate = authenticationSession();

  await authenticate();

  await authenticate();

  expect(webauthn.sendSignal).toHaveBeenCalledExactlyOnceWith({
    signalName: 'currentUserDetails',
    rpID: 'localhost',
    userID: Buffer.from(account.id).toString('base64url'),
    userName: account.email,
    userDisplayName: account.email,
  });

  expect(JSON.stringify(localStorage)).not.toContain(account.email);
  expect(JSON.stringify(localStorage)).not.toContain(account.id);

  await authenticate({ ...account, id: 'another-owner' });

  await authenticate(account, 'example.test');

  await authenticate({ ...account, email: 'updated@example.test' });

  await authenticate({ ...account, email: 'updated@example.test' });

  expect(webauthn.sendSignal).toHaveBeenCalledTimes(4);
  expect(webauthn.sendSignal).toHaveBeenLastCalledWith(
    expect.objectContaining({ userName: 'updated@example.test', userDisplayName: 'updated@example.test' }),
  );
});

it('retries a rejected credential manager update without blocking either sign-in', async () => {
  const authenticate = authenticationSession();

  vi.mocked(webauthn.sendSignal).mockRejectedValueOnce(new Error('synthetic_signal_unsupported'));

  await authenticate();

  await authenticate();

  expect(webauthn.sendSignal).toHaveBeenCalledTimes(2);
});

it('allows sign-in when the browser cannot retain the update marker', async () => {
  const authenticate = authenticationSession();

  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Synthetic storage denied', 'SecurityError');
  });

  await authenticate();

  expect(webauthn.sendSignal).not.toHaveBeenCalled();
});

it('never signals unverified account details to a credential manager', async () => {
  await authenticationSession('unverified')();

  expect(webauthn.sendSignal).not.toHaveBeenCalled();
});
