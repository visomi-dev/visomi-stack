import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Auth } from '../shared/auth/auth';
import { PasswordAuth } from '../shared/auth/password';
import { Passkey } from '../shared/auth/passkey';

import { SignUp } from './sign-up/sign-up';
import { PasswordReset } from './password-reset/password-reset';

describe('New password form validation', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Auth, useValue: {} },
        { provide: PasswordAuth, useValue: {} },
        { provide: Passkey, useValue: {} },
      ],
    }),
  );

  it.each([
    ['😀'.repeat(12), true],
    ['😀'.repeat(128), true],
    ['😀'.repeat(129), false],
    ['e\u0301'.repeat(11), false],
    ['e\u0301'.repeat(128), true],
    ['a'.repeat(11), false],
  ])('applies normalized code-point bounds to signup and reset (%s)', (password, valid) => {
    const signup = TestBed.runInInjectionContext(() => new SignUp());
    const reset = TestBed.runInInjectionContext(() => new PasswordReset());

    signup.model.set({ email: 'person@example.test', password: String(password), confirmation: String(password) });
    reset.resetModel.update((model) => ({
      ...model,
      password: String(password),
      confirmation: String(password),
      emailCode: '123456',
    }));
    expect(signup.form().valid()).toBe(valid);
    expect(reset.resetForm().valid()).toBe(valid);
  });
});
