import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Auth } from '../../shared/auth/auth';
import { APP_NAME } from '../../shared/constants/brand';
import type { RestrictedAccount } from '../../shared/auth/auth.models';
import { Passkey } from '../../shared/auth/passkey';
import { GoogleIdentity } from '../../shared/auth/google-identity';
import { PasswordAuth } from '../../shared/auth/password';
import { authDestination } from '../../shared/constants/routes';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';
import { PasswordInput } from '../../shared/ui/forms/password-input/password-input';
import { Select } from '../../shared/ui/forms/select/select';

import { SignInPasskey } from './sign-in-passkey';
import { SignInEnrollment } from './sign-in-enrollment';
import { SignInModel } from './sign-in-model';
import { SignInPassword } from './sign-in-password';
import { SignInRecovery } from './sign-in-recovery';

@Component({
  host: { class: /* tw */ 'block min-h-full w-full' },
  imports: [AppForm, AuthCard, AuthLayout, ErrorMessage, Field, Input, Label, PasswordInput, Select, RouterLink],
  selector: 'app-sign-in',
  templateUrl: './sign-in.html',
  styleUrl: './sign-in.css',
})
export class SignIn {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(Auth);
  private readonly passkey = inject(Passkey);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly google = inject(GoogleIdentity);
  private readonly password = inject(PasswordAuth);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private readonly model = new SignInModel();
  readonly methodsOpen = this.model.methodsOpen;
  readonly passkeyVerifying = this.model.passkeyVerifying;
  readonly state = this.model.state;
  readonly errorMessage = this.model.errorMessage;
  readonly accounts = this.model.accounts;
  readonly selectedAccount = this.model.selectedAccount;
  readonly flowId = this.model.flowId;
  readonly resendAvailableAt = this.model.resendAvailableAt;
  readonly clock = this.model.clock;
  readonly verificationNotice = this.model.verificationNotice;
  readonly verificationRestartRequired = this.model.verificationRestartRequired;
  readonly recoverySubmitting = this.model.recoverySubmitting;
  readonly recoveryFactorModel = this.model.recoveryFactorModel;
  readonly verificationChallengeId = this.model.verificationChallengeId;
  readonly identityFlowId = this.model.identityFlowId;
  readonly googleClientId = this.model.googleClientId;
  readonly passwordFlow = this.model.passwordFlow;
  readonly passwordFactor = this.model.passwordFactor;
  readonly passwordSubmitting = this.model.passwordSubmitting;
  readonly passwordSetupSubmitting = this.model.passwordSetupSubmitting;
  readonly emailModel = this.model.emailModel;
  readonly otpModel = this.model.otpModel;
  readonly enrollmentModel = this.model.enrollmentModel;
  readonly passwordModel = this.model.passwordModel;
  readonly passwordSetupModel = this.model.passwordSetupModel;
  readonly recoveryFactorForm = this.model.recoveryFactorForm;
  readonly emailForm = this.model.emailForm;
  readonly otpForm = this.model.otpForm;
  readonly enrollmentForm = this.model.enrollmentForm;
  readonly passwordForm = this.model.passwordForm;
  readonly passwordSetupForm = this.model.passwordSetupForm;
  readonly resendSeconds = this.model.resendSeconds;
  readonly emailError = this.model.emailError;
  readonly passwordEmailError = this.model.passwordEmailError;
  readonly passwordError = this.model.passwordError;
  readonly passwordSetupError = this.model.passwordSetupError;
  readonly passwordConfirmationError = this.model.passwordConfirmationError;
  readonly otpError = this.model.otpError;
  readonly labelError = this.model.labelError;
  readonly verificationOptions = this.model.verificationOptions;

  protected readonly appName = APP_NAME;

  private readonly passwordFlowActions = new SignInPassword(this.model, this.auth, this.password, this.router, () =>
    this.destination(),
  );
  private readonly recoveryActions = new SignInRecovery(this.model, this.auth);
  private readonly enrollmentActions = new SignInEnrollment(this.model, this.auth, this.passkey, this.router, () =>
    this.destination(),
  );
  private readonly googleButton = viewChild<ElementRef<HTMLElement>>('googleButton');
  private readonly methodDialog = viewChild<ElementRef<HTMLDialogElement>>('methodDialog');
  private readonly continueButton = viewChild<ElementRef<HTMLButtonElement>>('continueButton');
  private readonly methodOpener = viewChild<ElementRef<HTMLButtonElement>>('methodOpener');
  private readonly safeError = this.model.safeError.bind(this.model);
  private readonly passkeyActions = new SignInPasskey(
    this.model,
    this.auth,
    this.passkey,
    this.router,
    () => this.destination(),
    () => this.closeMethods(),
    () => this.showMethodSheet(),
  );

  private googleAttempt = 0;

  constructor() {
    afterNextRender(() => void this.passkeyActions.suggestPasskey());
    this.destroyRef.onDestroy(() => {
      this.model.destroyed = true;
      this.model.passwordAttempt += 1;
      this.model.recoveryAttempt += 1;
      this.otpModel.set({ pin: '' });
      this.passwordModel.update((model) => ({ ...model, password: '' }));
      this.passwordSetupModel.set({ password: '', confirmation: '' });
      this.passkeyActions.cancelCredential();
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      if (this.passwordSubmitting() && this.state() === 'password-factor') {
        return;
      }
      if (params.get('method') === 'password') {
        this.passkeyActions.cancelCredential();
        this.closeMethods();
        this.state.set('password');
      } else if (this.state() === 'password' || this.state() === 'password-factor') {
        this.model.passwordAttempt += 1;
        this.passwordFlow.set(null);
        this.passwordFactor.set(null);
        this.passwordSubmitting.set(false);
        this.flowId.set('');
        this.resendAvailableAt.set('');
        this.otpModel.set({ pin: '' });
        this.passwordModel.update((model) => ({ ...model, password: '' }));
        this.errorMessage.set('');
        this.state.set('ready');
      }
    });
  }

  protected authenticateWithPasskey(): Promise<void> {
    return this.passkeyActions.authenticateWithPasskey();
  }

  protected openMethods(): void {
    if (this.passkeyVerifying()) {
      return;
    }
    const immediate = this.passkeyActions.immediateOptions;

    this.passkeyActions.immediateOptions = undefined;
    this.passkeyActions.cancelCredential();
    if (immediate && immediate.expiresAt > Date.now() + 5000) {
      this.passkeyVerifying.set(true);
      void this.passkeyActions.authenticateImmediately(immediate);

      return;
    }
    if (this.passkey.isSupported()) {
      void this.passkeyActions.authenticateWithPasskey();

      return;
    }

    this.showMethodSheet();
  }

  protected useAnotherMethod(): void {
    if (this.passkeyVerifying()) {
      return;
    }
    this.passkeyActions.immediateOptions = undefined;
    this.passkeyActions.cancelCredential();
    this.state.set('ready');
    this.showMethodSheet();
  }

  protected closeMethods(): void {
    if (this.passkeyVerifying()) {
      return;
    }
    this.googleAttempt += 1;
    this.methodsOpen.set(false);
  }

  protected async showGoogle(): Promise<void> {
    if (this.passkeyVerifying()) {
      return;
    }
    this.passkeyActions.cancelCredential();
    const attempt = ++this.googleAttempt;
    const active = () => !this.model.destroyed && this.methodsOpen() && attempt === this.googleAttempt;

    try {
      const flow = await this.passkeyActions.prepareIdentityFlow();

      if (!active()) {
        return;
      }
      this.identityFlowId.set(flow.flowId);
      if (!flow.google?.enabled || !flow.google.clientId || !flow.nonce || !this.googleButton()) {
        return;
      }
      this.googleClientId.set(flow.google.clientId);
      await this.google.renderButton(
        this.googleButton()!.nativeElement,
        flow.google.clientId,
        flow.flowId,
        flow.nonce,
        (user) => {
          void this.auth.ensureSessionLoaded(true).then(() => {
            if (!this.model.destroyed) {
              return this.router.navigateByUrl(this.destination());
            }

            return false;
          });
          this.state.set('success');
          this.selectedAccount.set(null);
          this.errorMessage.set('');
          void user;
        },
        () => {
          this.passkeyVerifying.set(false);
          if (active()) {
            this.errorMessage.set($localize`:@@identityGoogleFailed:Google sign-in is not available right now.`);
          }
        },
        () => {
          if (!active()) {
            return false;
          }
          this.passkeyVerifying.set(true);

          return true;
        },
        active,
      );
    } catch (error) {
      if (!active()) {
        return;
      }
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityGoogleFailed:Google sign-in is not available right now.`),
      );
    }
  }

  protected showEmailRecovery(): void {
    if (this.passkeyVerifying()) {
      return;
    }
    this.passkeyActions.cancelCredential();
    this.closeMethods();
    this.errorMessage.set('');

    if (!this.emailModel().email) {
      this.state.set('email');

      return;
    }

    void this.sendEmailOtp();
  }

  protected showPassword(): void {
    if (this.passkeyVerifying() || this.passwordSubmitting()) {
      return;
    }
    this.passkeyActions.cancelCredential();
    this.closeMethods();
    this.errorMessage.set('');
    this.model.passwordAttempt += 1;
    this.flowId.set('');
    this.passwordFlow.set(null);
    this.passwordFactor.set(null);
    this.otpModel.set({ pin: '' });
    this.verificationRestartRequired.set(false);
    this.verificationNotice.set('');
    this.passwordModel.update((model) => ({ ...model, email: this.emailModel().email || model.email, password: '' }));
    this.state.set('password');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { method: 'password' },
      queryParamsHandling: 'merge',
    });
  }

  protected signInWithPassword(): Promise<void> {
    return this.passwordFlowActions.signInWithPassword();
  }

  protected verifyPassword(): Promise<void> {
    return this.passwordFlowActions.verifyPassword();
  }

  protected togglePasswordFactor(): void {
    return this.passwordFlowActions.togglePasswordFactor();
  }

  protected changeRecoveryFactor(kind: string): void {
    if (kind === 'totp' || kind === 'recovery_code') {
      this.recoveryFactorModel.set({ kind, code: '' });
    }
  }

  protected resendPasswordCode(): Promise<void> {
    return this.passwordFlowActions.resendPasswordCode();
  }

  protected showReady(): void {
    if (this.passwordSubmitting() || this.recoverySubmitting() || this.passkeyVerifying()) {
      return;
    }
    this.errorMessage.set('');
    this.passwordModel.update((model) => ({ ...model, password: '' }));
    this.state.set('ready');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { method: null },
      queryParamsHandling: 'merge',
    });
  }

  protected async requestCode(): Promise<void> {
    if (this.emailForm().invalid()) {
      return;
    }

    await this.sendEmailOtp();
  }

  protected changeRecoveryEmail(): void {
    if (this.recoverySubmitting()) {
      return;
    }
    this.model.recoveryAttempt += 1;
    this.identityFlowId.set('');
    this.flowId.set('');
    this.otpModel.set({ pin: '' });
    this.errorMessage.set('');
    this.verificationRestartRequired.set(false);
    this.state.set('email');
    afterNextRender(() => this.document.getElementById('identity-email')?.focus(), { injector: this.injector });
  }

  protected verifyCode(): Promise<void> {
    return this.recoveryActions.verifyCode();
  }

  protected loadRecoveryAccounts(): Promise<void> {
    return this.recoveryActions.loadRecoveryAccounts();
  }

  protected chooseAccount(account: RestrictedAccount): Promise<void> {
    return this.recoveryActions.chooseAccount(account);
  }

  protected skipPasswordSetup(): void {
    this.errorMessage.set('');
    this.state.set('enrollment');
  }

  protected setPassword(): Promise<void> {
    return this.passwordFlowActions.setPassword();
  }

  protected continueToPasskeyEnrollment(): void {
    this.errorMessage.set('');
    this.state.set('enrollment');
  }

  protected createPasskey(): Promise<void> {
    return this.enrollmentActions.createPasskey();
  }

  protected verifyNewPasskey(): Promise<void> {
    return this.enrollmentActions.verifyNewPasskey();
  }

  private destination(): string {
    return authDestination(this.route.snapshot.queryParamMap.get('returnTo'));
  }

  private showMethodSheet(): void {
    this.methodsOpen.set(true);
    this.errorMessage.set('');
    afterNextRender(
      () => {
        if (this.methodsOpen()) {
          void this.showGoogle();
        }
      },
      { injector: this.injector },
    );
  }

  private sendEmailOtp(): Promise<void> {
    return this.recoveryActions.sendEmailOtp();
  }

  private readonly syncMethodDialog = afterRenderEffect({
    write: () => {
      const dialog = this.methodDialog()?.nativeElement;

      if (!dialog) {
        return;
      }
      if (this.methodsOpen() && !dialog.open) {
        dialog.showModal();
      } else if (!this.methodsOpen() && dialog.open) {
        dialog.close();
        (this.methodOpener() ?? this.continueButton())?.nativeElement.focus();
      }
    },
  });

  private readonly syncResendClock = afterRenderEffect((onCleanup) => {
    if (this.state() !== 'password-factor' || this.passwordFactor() !== 'email' || !this.resendAvailableAt()) {
      return;
    }
    const window = this.document.defaultView;

    if (!window) {
      return;
    }
    const update = () => this.clock.set(Date.now());

    update();
    const timer = window.setInterval(update, 1000);

    this.document.addEventListener('visibilitychange', update);
    onCleanup(() => {
      window.clearInterval(timer);
      this.document.removeEventListener('visibilitychange', update);
    });
  });
}
