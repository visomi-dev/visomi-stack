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
  bufferToBase64URLString: vi.fn(() => 'synthetic_encoded_owner'),
  sendSignal: vi.fn().mockResolvedValue(undefined),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: () => true,
  browserSupportsWebAuthnAutofill: async () => true,
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));

afterEach(() => vi.clearAllMocks());
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

for (const unsupported of [false, true]) {
  it(`updates a saved account name after successful authentication (unsupported signal: ${unsupported})`, async () => {
    const result = {
      access: 'full',
      user: { id: 'synthetic-owner', email: 'synthetic@example.test' },
    };

    const request = vi
      .fn()
      .mockResolvedValueOnce({ challengeId: 'synthetic-challenge', options: { rpId: 'localhost' } })
      .mockResolvedValueOnce(result);

    vi.mocked(webauthn.startAuthentication).mockResolvedValue({} as never);
    vi.mocked(webauthn.sendSignal).mockImplementation(async () => {
      if (unsupported) {
        throw new Error('synthetic_signal_unsupported');
      }
    });

    TestBed.configureTestingModule({
      providers: [
        Passkeys,
        { provide: Session, useValue: { cancellation: () => new AbortController().signal } },
        { provide: AuthHttp, useValue: { request } },
      ],
    });

    const authenticated = await TestBed.inject(Passkeys).authenticate();

    expect(authenticated).toBe(result);
    expect(webauthn.sendSignal).toHaveBeenCalledExactlyOnceWith({
      signalName: 'currentUserDetails',
      rpID: 'localhost',
      userID: 'synthetic_encoded_owner',
      userName: 'synthetic@example.test',
      userDisplayName: 'synthetic@example.test',
    });
  });
}

it('never signals unverified account details to a credential manager', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ challengeId: 'synthetic-challenge', options: { rpId: 'localhost' } })
    .mockResolvedValueOnce({ access: 'unverified', user: { id: 'synthetic', email: 'synthetic@example.test' } });

  vi.mocked(webauthn.startAuthentication).mockResolvedValue({} as never);
  TestBed.configureTestingModule({
    providers: [
      Passkeys,
      { provide: Session, useValue: { cancellation: () => new AbortController().signal } },
      { provide: AuthHttp, useValue: { request } },
    ],
  });

  await TestBed.inject(Passkeys).authenticate();

  expect(webauthn.sendSignal).not.toHaveBeenCalled();
});
