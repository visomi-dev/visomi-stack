import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { Auth } from '../../shared/auth/auth';
import { Passkey } from '../../shared/auth/passkey';
import { PasswordAuth } from '../../shared/auth/password';

import { SignUp } from './sign-up';

class SignUpHarness extends SignUp {
  register(): Promise<void> {
    return this.createPasskey();
  }

  cancel(): void {
    this.cancelSignUp();
  }
}

describe('passkey signup boundaries', () => {
  function setup(supported = true) {
    const params = new BehaviorSubject(convertToParamMap({}));
    const passkey = {
      isSupported: vi.fn(() => supported),
      beginSignUp: vi.fn(async (_email: string) => ({ challengeId: 'synthetic-challenge', options: {} })),
      createCredential: vi.fn(async (_options: unknown, _request?: { signal?: AbortSignal }) => ({
        id: 'synthetic-credential',
      })),
      completeSignUp: vi.fn(async (): Promise<void> => undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } },
        { provide: Auth, useValue: {} },
        { provide: PasswordAuth, useValue: {} },
        { provide: Passkey, useValue: passkey },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new SignUpHarness());

    return { component, passkey, params };
  }

  it.each(['', 'not-an-email'])('never starts registration without a valid email (%s)', async (email) => {
    const { component, passkey } = setup();

    component.passkeyEmailModel.set({ email });
    await component.register();
    expect(passkey.beginSignUp).not.toHaveBeenCalled();
    expect(component.passkeyEmailPending()).toBe(false);
  });

  it('requires email but does not require a password in passkey mode', async () => {
    const { component, passkey } = setup();

    component.passkeyEmailModel.set({ email: 'synthetic@example.test' });
    expect(component.form().invalid()).toBe(true);
    await component.register();
    expect(passkey.beginSignUp).toHaveBeenCalledWith('synthetic@example.test');
    expect(passkey.completeSignUp).toHaveBeenCalledTimes(1);
    expect(component.passkeyEmailPending()).toBe(true);
    expect(component.complete()).toBe(false);
    expect(component.submitting()).toBe(false);
  });

  it('offers a supported fallback without starting a browser ceremony', async () => {
    const { component, passkey } = setup(false);

    component.passkeyEmailModel.set({ email: 'synthetic@example.test' });
    await component.register();
    expect(passkey.beginSignUp).not.toHaveBeenCalled();
    expect(component.error()).toContain('password');
    expect(component.submitting()).toBe(false);
  });

  it('preserves email after cancellation and permits a deliberate retry', async () => {
    const { component, passkey } = setup();

    component.passkeyEmailModel.set({ email: 'synthetic@example.test' });
    passkey.createCredential.mockRejectedValueOnce(new DOMException('Cancelled', 'NotAllowedError'));
    await component.register();
    expect(component.error()).toContain('cancelled');
    expect(component.passkeyEmailModel().email).toBe('synthetic@example.test');
    expect(component.passkeyEmailPending()).toBe(false);
    await component.register();
    expect(passkey.completeSignUp).toHaveBeenCalledTimes(1);
    expect(component.error()).toBe('');
    expect(component.passkeyEmailPending()).toBe(true);
  });

  it('does not start a second ceremony while the first is pending', async () => {
    const { component, passkey } = setup();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    passkey.beginSignUp.mockImplementationOnce(async () => {
      await pending;

      return { challengeId: 'synthetic-challenge', options: {} };
    });
    component.passkeyEmailModel.set({ email: 'synthetic@example.test' });
    const first = component.register();

    await component.register();
    expect(passkey.beginSignUp).toHaveBeenCalledTimes(1);
    release?.();
    await first;
    expect(passkey.completeSignUp).toHaveBeenCalledTimes(1);
  });

  it('does not finish a late browser credential after leaving signup', async () => {
    const { component, passkey } = setup();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    passkey.createCredential.mockImplementationOnce(async () => {
      await pending;

      return { id: 'synthetic-credential' };
    });
    component.passkeyEmailModel.set({ email: 'synthetic@example.test' });
    const first = component.register();

    await Promise.resolve();
    expect(passkey.createCredential).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();
    release?.();
    await first;
    expect(passkey.completeSignUp).not.toHaveBeenCalled();
    expect(component.passkeyEmailPending()).toBe(false);
  });

  it('ignores a late credential after changing methods, even after switching back', async () => {
    const { component, passkey, params } = setup();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    passkey.createCredential.mockImplementationOnce(async () => {
      await pending;

      return { id: 'synthetic-credential' };
    });
    component.passkeyEmailModel.set({ email: 'synthetic@example.test' });
    const first = component.register();

    await Promise.resolve();
    params.next(convertToParamMap({ method: 'password' }));
    params.next(convertToParamMap({}));
    release?.();
    await first;
    expect(passkey.completeSignUp).not.toHaveBeenCalled();
    expect(component.passkeyEmailPending()).toBe(false);
    expect(component.error()).toBe('');
  });

  it('does not apply a late completion or clear the pending state of a new attempt after cancel', async () => {
    const { component, passkey } = setup();
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondPending = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    passkey.completeSignUp.mockImplementationOnce(() => firstPending);
    passkey.beginSignUp.mockImplementationOnce(async () => ({ challengeId: 'first', options: {} }));
    component.passkeyEmailModel.set({ email: 'synthetic@example.test' });
    const first = component.register();

    await Promise.resolve();
    await Promise.resolve();
    expect(passkey.completeSignUp).toHaveBeenCalledTimes(1);
    component.cancel();
    passkey.beginSignUp.mockImplementationOnce(async () => {
      await secondPending;

      return { challengeId: 'second', options: {} };
    });
    const second = component.register();

    releaseFirst?.();
    await first;
    expect(component.submitting()).toBe(true);
    expect(component.passkeyEmailPending()).toBe(false);
    releaseSecond?.();
    await second;
    expect(component.passkeyEmailPending()).toBe(true);
  });

  it('ignores a rejected browser prompt after cancellation', async () => {
    const { component, passkey } = setup();
    let reject: ((error: Error) => void) | undefined;
    const pending = new Promise<never>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });

    passkey.createCredential.mockImplementationOnce(() => pending);
    component.passkeyEmailModel.set({ email: 'synthetic@example.test' });
    const first = component.register();

    await Promise.resolve();
    component.cancel();
    reject?.(new Error('Late cancellation'));
    await first;
    expect(component.error()).toBe('');
    expect(component.submitting()).toBe(false);
  });

  it.each(['cancel', 'method', 'destroy'] as const)('aborts the owned browser registration on %s', async (action) => {
    const { component, passkey, params } = setup();
    let aborted = false;

    passkey.createCredential.mockImplementationOnce(
      (_options, request) =>
        new Promise((_resolve, reject) => {
          request?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('Cancelled', 'AbortError'));
          });
        }),
    );
    component.passkeyEmailModel.set({ email: 'synthetic@example.test' });
    const pending = component.register();

    await Promise.resolve();
    expect(passkey.createCredential).toHaveBeenCalledTimes(1);
    if (action === 'cancel') {
      component.cancel();
    } else if (action === 'method') {
      params.next(convertToParamMap({ method: 'password' }));
    } else {
      TestBed.resetTestingModule();
    }

    await pending;
    expect(aborted).toBe(true);
    expect(passkey.completeSignUp).not.toHaveBeenCalled();
    expect(component.error()).toBe('');
  });
});
