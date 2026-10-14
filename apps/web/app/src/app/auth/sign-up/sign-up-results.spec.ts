import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { Auth } from '../../shared/auth/auth';
import { Passkey } from '../../shared/auth/passkey';
import { PasswordAuth } from '../../shared/auth/password';
import { Settings } from '../../shared/settings';

import { SignUp } from './sign-up';

class SignUpHarness extends SignUp {
  registerPassword(): Promise<void> {
    return this.signUp();
  }

  verify(): Promise<void> {
    return this.verifySignUp();
  }

  cancel(): void {
    this.cancelSignUp();
  }

  continue(): Promise<void> {
    return this.continueSignUp();
  }
}

function deferred() {
  let resolve = () => undefined as void;
  let reject = (_error: unknown) => undefined as void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function setup(method: 'password' | 'passkey' = 'password', authenticated = false) {
  const params = new BehaviorSubject(convertToParamMap({ method, returnTo: '/security', source: 'signup-test' }));
  const auth = {
    isAuthenticated: signal(authenticated),
    ensureSessionLoaded: vi.fn(async (): Promise<void> => undefined),
  };
  const password = {
    signUp: vi.fn(async () => ({ flowId: 'current-flow' })),
    verifySignUp: vi.fn(async (_flowId: string, _code: string) => ({ authenticated: true })),
  };
  const passkey = { verifySignUp: vi.fn(async (_code: string) => ({ authenticated: true })) };

  TestBed.configureTestingModule({
    imports: [SignUp],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } },
      { provide: Auth, useValue: auth },
      { provide: PasswordAuth, useValue: password },
      { provide: Passkey, useValue: passkey },
      { provide: Settings, useValue: { isDark: signal(false), toggleTheme: vi.fn() } },
    ],
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const component = TestBed.runInInjectionContext(() => new SignUpHarness());

  component.model.set({
    email: 'synthetic@example.test',
    password: 'synthetic-password',
    confirmation: 'synthetic-password',
  });

  return { component, password, passkey, auth, navigate, params };
}

function prepareVerification(component: SignUp, method: 'password' | 'passkey') {
  if (method === 'password') {
    component.flowId.set('current-flow');
  } else {
    component.passkeyEmailPending.set(true);
  }

  component.codeModel.set({ code: '123456' });
}

describe('truthful signup completion', () => {
  it.each(['password', 'passkey'] as const)(
    'requires sign-in after %s verification without a session',
    async (method) => {
      const { component, password, passkey, auth, navigate } = setup(method);

      prepareVerification(component, method);
      await component.verify();
      expect(auth.ensureSessionLoaded).toHaveBeenCalledWith(true);
      expect(component.complete()).toBe(false);
      expect(component.needsSignIn()).toBe(true);
      expect(component.codeModel().code).toBe('');
      expect(component.flowId()).toBe('');
      expect(component.passkeyEmailPending()).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      await component.verify();
      expect(password.verifySignUp.mock.calls.length + passkey.verifySignUp.mock.calls.length).toBe(1);
      await component.continue();
      expect(navigate).toHaveBeenCalledWith(['/auth/sign-in'], { queryParamsHandling: 'preserve' });
    },
  );

  it.each(['password', 'passkey'] as const)('continues authenticated %s signup to the workspace', async (method) => {
    const { component, auth, navigate } = setup(method, true);

    prepareVerification(component, method);
    await component.verify();
    expect(auth.ensureSessionLoaded).toHaveBeenCalledWith(true);
    expect(component.complete()).toBe(true);
    expect(component.needsSignIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/'], { queryParamsHandling: 'preserve' });
  });

  it('shows a sign-in action without claiming a session in the rendered result', async () => {
    const { navigate } = setup();
    const fixture = TestBed.createComponent(SignUp);
    const component = fixture.componentInstance;

    prepareVerification(component, 'password');
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const verifyButton = Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Verify email',
    );

    verifyButton?.click();
    await fixture.whenStable();

    expect(element.textContent).toContain('Your account is verified');
    expect(element.textContent).toContain('Your email is verified. Sign in to continue setting up your account.');
    expect(element.textContent).not.toContain('This browser is now signed in');
    expect(element.textContent).not.toContain('Continue to workspace');
    const continueButton = Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Sign in to continue',
    );

    expect(continueButton).toBeDefined();
    continueButton?.click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/auth/sign-in'], { queryParamsHandling: 'preserve' });
  });

  it('renders authenticated completion with a setup action rather than asking for sign-in', async () => {
    setup('password', true);
    const fixture = TestBed.createComponent(SignUp);
    const component = fixture.componentInstance;

    prepareVerification(component, 'password');
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const verifyButton = Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Verify email',
    );

    verifyButton?.click();
    await fixture.whenStable();
    expect(element.textContent).toContain('Your email is verified. Continue to your workspace.');
    expect(element.textContent).toContain('Continue to workspace');
    expect(element.textContent).not.toContain('Sign in to continue');
  });

  it('rechecks a completed session before a manual continuation', async () => {
    const { component, auth, navigate } = setup('password', true);

    prepareVerification(component, 'password');
    await component.verify();
    auth.isAuthenticated.set(false);
    await component.continue();
    expect(navigate).toHaveBeenLastCalledWith(['/auth/sign-in'], { queryParamsHandling: 'preserve' });
  });

  it('does not mislabel a failed session check as an invalid code or retry a consumed OTP', async () => {
    const { component, auth, password, navigate } = setup('password', true);

    prepareVerification(component, 'password');
    auth.ensureSessionLoaded.mockRejectedValueOnce(new Error('Session unavailable'));
    await component.verify();
    expect(component.complete()).toBe(false);
    expect(component.needsSignIn()).toBe(true);
    expect(component.error()).toContain('could not confirm that you are signed in');
    await component.verify();
    expect(password.verifySignUp).toHaveBeenCalledTimes(1);
    await component.continue();
    expect(navigate).toHaveBeenCalledWith(['/auth/sign-in'], { queryParamsHandling: 'preserve' });
  });

  it('keeps the verification task and permits correction after an invalid OTP', async () => {
    const { component, password, auth } = setup();

    prepareVerification(component, 'password');
    password.verifySignUp.mockRejectedValueOnce(new HttpErrorResponse({ status: 400, error: {} }));
    await component.verify();
    expect(component.flowId()).toBe('current-flow');
    expect(component.error()).toContain('not valid');
    expect(component.complete()).toBe(false);
    expect(component.needsSignIn()).toBe(false);
    expect(auth.ensureSessionLoaded).not.toHaveBeenCalled();
    component.codeModel.set({ code: '654321' });
    await component.verify();
    expect(password.verifySignUp).toHaveBeenLastCalledWith('current-flow', '654321');
    expect(component.needsSignIn()).toBe(true);
  });

  it('keeps authenticated completion available if the first workspace navigation fails', async () => {
    const { component, navigate } = setup('password', true);

    navigate.mockRejectedValueOnce(new Error('Navigation unavailable'));
    prepareVerification(component, 'password');
    await component.verify();
    expect(component.complete()).toBe(true);
    expect(component.needsSignIn()).toBe(false);
    expect(component.error()).toBe('');
    expect(component.submitting()).toBe(false);
    await component.continue();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith(['/'], { queryParamsHandling: 'preserve' });
  });
});

describe('signup attempt integrity', () => {
  it('requires a valid password-mode email and ignores registration in the wrong method', async () => {
    const { component, password, params } = setup();

    component.model.update((model) => ({ ...model, email: '' }));
    await component.registerPassword();
    expect(password.signUp).not.toHaveBeenCalled();
    component.model.update((model) => ({ ...model, email: 'synthetic@example.test' }));
    params.next(convertToParamMap({}));
    await component.registerPassword();
    expect(password.signUp).not.toHaveBeenCalled();
  });

  it('ignores password registration arriving after a method change', async () => {
    const { component, password, params } = setup();
    const pending = deferred();

    password.signUp.mockImplementationOnce(async () => {
      await pending.promise;

      return { flowId: 'stale-flow' };
    });
    const first = component.registerPassword();

    await component.registerPassword();
    expect(password.signUp).toHaveBeenCalledTimes(1);
    params.next(convertToParamMap({}));
    pending.resolve();
    await first;
    expect(component.flowId()).toBe('');
    expect(component.submitting()).toBe(false);
    expect(component.model().password).toBe('');
  });

  it.each(['password', 'passkey'] as const)('denies duplicate %s OTP submissions', async (method) => {
    const { component, password, passkey, auth } = setup(method);
    const pending = deferred();
    const verify = method === 'password' ? password.verifySignUp : passkey.verifySignUp;

    verify.mockImplementationOnce(async () => {
      await pending.promise;

      return { authenticated: true };
    });
    prepareVerification(component, method);
    const first = component.verify();

    await component.verify();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(auth.ensureSessionLoaded).not.toHaveBeenCalled();
    pending.resolve();
    await first;
    expect(auth.ensureSessionLoaded).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['password', 'cancel'],
    ['passkey', 'cancel'],
    ['password', 'method'],
    ['passkey', 'method'],
    ['password', 'destroy'],
    ['passkey', 'destroy'],
  ] as const)('ignores a late %s OTP after %s before loading a session', async (method, action) => {
    const { component, password, passkey, auth, navigate, params } = setup(method, true);
    const pending = deferred();
    const verify = method === 'password' ? password.verifySignUp : passkey.verifySignUp;

    verify.mockImplementationOnce(async () => {
      await pending.promise;

      return { authenticated: true };
    });
    prepareVerification(component, method);
    const first = component.verify();

    if (action === 'cancel') {
      component.cancel();
    } else if (action === 'method') {
      params.next(convertToParamMap({ method: method === 'password' ? 'passkey' : 'password' }));
    } else {
      TestBed.resetTestingModule();
    }

    pending.resolve();
    await first;
    expect(auth.ensureSessionLoaded).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(component.complete()).toBe(false);
    expect(component.needsSignIn()).toBe(false);
    expect(component.codeModel().code).toBe('');
  });

  it.each(['cancel', 'method', 'destroy'] as const)('ignores a late authenticated session after %s', async (action) => {
    const { component, auth, params, navigate } = setup();
    const pending = deferred();

    auth.ensureSessionLoaded.mockImplementationOnce(() => pending.promise);
    prepareVerification(component, 'password');
    const first = component.verify();

    await Promise.resolve();
    expect(auth.ensureSessionLoaded).toHaveBeenCalledTimes(1);
    if (action === 'cancel') {
      component.cancel();
    } else if (action === 'method') {
      params.next(convertToParamMap({}));
    } else {
      TestBed.resetTestingModule();
    }

    auth.isAuthenticated.set(true);
    pending.resolve();
    await first;
    expect(navigate).not.toHaveBeenCalled();
    expect(component.complete()).toBe(false);
    expect(component.needsSignIn()).toBe(false);
    expect(component.error()).toBe('');
  });

  it('does not let a canceled late OTP failure replace the next task or clear its pending flag', async () => {
    const { component, password } = setup();
    const old = deferred();
    const current = deferred();

    password.verifySignUp.mockImplementationOnce(async () => {
      await old.promise;

      return { authenticated: true };
    });
    prepareVerification(component, 'password');
    const first = component.verify();

    component.cancel();
    prepareVerification(component, 'password');
    password.verifySignUp.mockImplementationOnce(async () => {
      await current.promise;

      return { authenticated: true };
    });
    const second = component.verify();

    old.reject(new Error('Stale OTP failure'));
    await first;
    expect(component.submitting()).toBe(true);
    expect(component.error()).toBe('');
    expect(component.flowId()).toBe('current-flow');
    current.resolve();
    await second;
    expect(component.needsSignIn()).toBe(true);
  });
});
