import { HttpErrorResponse } from '@angular/common/http';
import { DateTime } from 'luxon';
import type { Router } from '@angular/router';

import type { Auth } from '../../shared/auth/auth';
import type { PasswordAuth } from '../../shared/auth/password';
import { EMAIL_VERIFICATION_URL } from '../../shared/constants/routes';

import type { SignInModel } from './sign-in-model';

export class SignInPassword {
  constructor(
    private readonly model: SignInModel,
    private readonly auth: Auth,
    private readonly password: PasswordAuth,
    private readonly router: Router,
    private readonly destination: () => string,
  ) {}

  async signInWithPassword(): Promise<void> {
    if (this.model.passwordForm().invalid() || this.model.passwordSubmitting()) {
      return;
    }
    const attempt = ++this.model.passwordAttempt;

    this.model.errorMessage.set('');
    this.model.passwordSubmitting.set(true);
    this.model.state.set('password');

    try {
      const password = this.model.passwordForm.password().value();

      this.model.passwordModel.update((model) => ({ ...model, password: '' }));
      const pending = await this.password.signIn({
        email: this.model.passwordForm.email().value(),
        password,
      });

      if (attempt !== this.model.passwordAttempt) {
        return;
      }

      this.model.passwordFlow.set(pending);
      this.model.passwordFactor.set(pending.requiredFactor);
      this.model.flowId.set(pending.flowId);
      this.model.resendAvailableAt.set(pending.resendAvailableAt ?? '');
      this.model.clock.set(Date.now());
      this.model.verificationRestartRequired.set(false);
      this.model.verificationNotice.set('');
      this.model.otpModel.set({ pin: '' });
      this.model.passwordModel.update((model) => ({ ...model, password: '' }));
      this.model.state.set('password-factor');
    } catch (error) {
      if (attempt !== this.model.passwordAttempt) {
        return;
      }
      if (error instanceof HttpErrorResponse && error.error?.code === 'email_unverified') {
        await this.router.navigate([EMAIL_VERIFICATION_URL], {
          queryParams: { email: this.model.passwordForm.email().value() },
        });

        return;
      }
      this.model.state.set('password');
      this.model.errorMessage.set(
        this.model.safeError(error, $localize`:@@identityPasswordFailed:We could not sign in with that password.`),
      );
    } finally {
      if (attempt === this.model.passwordAttempt) {
        this.model.passwordSubmitting.set(false);
      }
    }
  }

  async verifyPassword(): Promise<void> {
    const flowId = this.model.flowId();
    const factor = this.model.passwordFactor();

    if (
      !flowId ||
      !factor ||
      this.model.otpForm().invalid() ||
      this.model.passwordSubmitting() ||
      this.model.verificationRestartRequired()
    ) {
      return;
    }
    const attempt = this.model.passwordAttempt;

    this.model.errorMessage.set('');
    this.model.passwordSubmitting.set(true);
    this.model.state.set('password-factor');

    try {
      await this.password.verify(flowId, this.model.otpForm.pin().value(), factor);
      if (this.model.destroyed || attempt !== this.model.passwordAttempt) {
        return;
      }
      await this.auth.ensureSessionLoaded(true);
      if (this.model.destroyed || attempt !== this.model.passwordAttempt) {
        return;
      }
      this.model.state.set('success');
      await this.router.navigateByUrl(this.destination());
    } catch (error) {
      if (this.model.destroyed || attempt !== this.model.passwordAttempt) {
        return;
      }
      this.model.state.set('password-factor');
      this.model.errorMessage.set(this.model.verificationError(error));
    } finally {
      if (attempt === this.model.passwordAttempt) {
        this.model.passwordSubmitting.set(false);
      }
    }
  }

  togglePasswordFactor(): void {
    if (this.model.passwordSubmitting() || this.model.passwordFlow()?.requiredFactor !== 'totp') {
      return;
    }
    this.model.passwordFactor.set(this.model.passwordFactor() === 'recovery_code' ? 'totp' : 'recovery_code');
    this.model.otpModel.set({ pin: '' });
    this.model.errorMessage.set('');
  }

  async resendPasswordCode(): Promise<void> {
    const flowId = this.model.flowId();

    if (
      !flowId ||
      this.model.passwordFactor() !== 'email' ||
      this.model.passwordSubmitting() ||
      this.model.resendSeconds() > 0 ||
      this.model.verificationRestartRequired()
    ) {
      return;
    }
    const attempt = this.model.passwordAttempt;

    this.model.errorMessage.set('');
    this.model.verificationNotice.set('');
    this.model.passwordSubmitting.set(true);

    try {
      const response = await this.password.resend(flowId);

      if (this.model.destroyed || attempt !== this.model.passwordAttempt) {
        return;
      }
      this.model.resendAvailableAt.set(response.resendAvailableAt ?? '');
      this.model.clock.set(Date.now());
      this.model.verificationNotice.set($localize`:@@accessCodeResent:We sent a new code. Check your email.`);
    } catch (error) {
      if (this.model.destroyed || attempt !== this.model.passwordAttempt) {
        return;
      }
      if (error instanceof HttpErrorResponse && error.status === 429) {
        const retryAfter = error.headers.get('Retry-After');
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const httpDate = DateTime.fromHTTP(retryAfter ?? '');
        const retryDate = httpDate.isValid ? httpDate : DateTime.fromISO(retryAfter ?? '');
        const deadline = Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000 : retryDate.toMillis();

        if (Number.isFinite(deadline)) {
          this.model.resendAvailableAt.set(DateTime.fromMillis(deadline, { zone: 'utc' }).toISO() ?? '');
        }
        this.model.clock.set(Date.now());
      }
      this.model.errorMessage.set(
        this.model.verificationError(
          error,
          $localize`:@@identityPasswordResendFailed:We could not resend the verification code.`,
        ),
      );
    } finally {
      if (attempt === this.model.passwordAttempt) {
        this.model.passwordSubmitting.set(false);
      }
    }
  }

  async setPassword(): Promise<void> {
    if (this.model.passwordSetupForm().invalid() || this.model.passwordSetupSubmitting()) {
      return;
    }

    this.model.errorMessage.set('');
    this.model.passwordSetupSubmitting.set(true);
    this.model.state.set('password-setup-loading');

    try {
      await this.password.setPassword({ password: this.model.passwordSetupForm.password().value() });
      this.model.passwordSetupModel.set({ password: '', confirmation: '' });
      this.model.state.set('password-setup-success');
    } catch (error) {
      this.model.state.set('password-setup');
      this.model.errorMessage.set(
        this.model.safeError(
          error,
          $localize`:@@identityPasswordSetupFailed:We could not set your password. Try again.`,
        ),
      );
    } finally {
      this.model.passwordSetupSubmitting.set(false);
    }
  }
}
