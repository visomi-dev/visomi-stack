import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { email, form, maxLength, minLength, pattern, required, type FieldTree, validate } from '@angular/forms/signals';

import { Auth } from '../../shared/auth/auth';
import { APP_NAME } from '../../shared/constants/brand';
import type { RestrictedAccount } from '../../shared/auth/auth.models';
import { Passkey } from '../../shared/auth/passkey';
import { GoogleIdentity } from '../../shared/auth/google-identity';
import { PasswordAuth, type PasswordSecondFactor, type PasswordSignInPending } from '../../shared/auth/password';
import { authDestination, EMAIL_VERIFICATION_URL } from '../../shared/constants/routes';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';
import { ErrorMessage } from '../../shared/ui/forms/error-message/error-message';
import { Field } from '../../shared/ui/forms/field/field';
import { Form as AppForm } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';
import { PasswordInput } from '../../shared/ui/forms/password-input/password-input';

type AccessState =
  | 'ready'
  | 'passkey-loading'
  | 'passkey-error'
  | 'password'
  | 'password-factor'
  | 'email'
  | 'otp'
  | 'account-choice'
  | 'password-setup'
  | 'password-setup-loading'
  | 'password-setup-success'
  | 'enrollment'
  | 'enrollment-loading'
  | 'verification'
  | 'verification-loading'
  | 'success';

type EmailModel = { email: string };
type PasswordModel = { email: string; password: string };
type PasswordSetupModel = { password: string; confirmation: string };
type OtpModel = { pin: string };
type EnrollmentModel = { label: string };

@Component({
  host: { class: /* tw */ 'block min-h-full w-full' },
  imports: [AppForm, AuthCard, AuthLayout, ErrorMessage, Field, Input, Label, PasswordInput, RouterLink],
  selector: 'app-sign-in',
  templateUrl: './sign-in.html',
  styleUrl: './sign-in.css',
})
export class SignIn {
  protected readonly appName = APP_NAME;
  private passwordAttempt = 0;
  private recoveryAttempt = 0;
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(Auth);
  private readonly passkey = inject(Passkey);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly google = inject(GoogleIdentity);
  private readonly password = inject(PasswordAuth);
  private readonly googleButton = viewChild<ElementRef<HTMLElement>>('googleButton');
  private readonly methodDialog = viewChild<ElementRef<HTMLDialogElement>>('methodDialog');
  private readonly continueButton = viewChild<ElementRef<HTMLButtonElement>>('continueButton');
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private googleAttempt = 0;
  private credentialController?: AbortController;
  private credentialAttempt = 0;
  private identityPreparation?: ReturnType<Auth['startIdentityFlow']>;
  private immediateOptions?: { challengeId: string; options: Record<string, unknown>; expiresAt: number };
  private destroyed = false;
  readonly methodsOpen = signal(false);
  private destination(): string {
    return authDestination(this.route.snapshot.queryParamMap.get('returnTo'));
  }
  readonly passkeyVerifying = signal(false);

  private readonly syncMethodDialog = afterRenderEffect(() => {
    const dialog = this.methodDialog()?.nativeElement;

    if (!dialog) return;
    if (this.methodsOpen() && !dialog.open) dialog.showModal();
    else if (!this.methodsOpen() && dialog.open) {
      dialog.close();
      this.continueButton()?.nativeElement.focus();
    }
  });

  readonly state = signal<AccessState>('ready');
  readonly errorMessage = signal('');
  readonly accounts = signal<RestrictedAccount[]>([]);
  readonly selectedAccount = signal<RestrictedAccount | null>(null);
  readonly flowId = signal('');
  readonly resendAvailableAt = signal('');
  private readonly clock = signal(Date.now());
  readonly resendSeconds = computed(() => {
    const deadline = Date.parse(this.resendAvailableAt());

    return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - this.clock()) / 1000)) : 0;
  });
  readonly verificationNotice = signal('');
  readonly verificationRestartRequired = signal(false);
  readonly recoverySubmitting = signal(false);
  private readonly syncResendClock = afterRenderEffect((onCleanup) => {
    if (this.state() !== 'password-factor' || this.passwordFactor() !== 'email' || !this.resendAvailableAt()) return;
    const window = this.document.defaultView;

    if (!window) return;
    const update = () => this.clock.set(Date.now());

    update();
    const timer = window.setInterval(update, 1000);

    this.document.addEventListener('visibilitychange', update);
    onCleanup(() => {
      window.clearInterval(timer);
      this.document.removeEventListener('visibilitychange', update);
    });
  });
  readonly verificationChallengeId = signal('');
  readonly verificationOptions = signal<Record<string, unknown> | null>(null);
  readonly identityFlowId = signal('');
  readonly googleClientId = signal<string | null>(null);
  readonly passwordFlow = signal<PasswordSignInPending | null>(null);
  readonly passwordFactor = signal<PasswordSecondFactor | null>(null);
  readonly passwordSubmitting = signal(false);
  readonly passwordSetupSubmitting = signal(false);

  readonly emailModel = signal<EmailModel>({ email: '' });
  readonly emailForm: FieldTree<EmailModel> = form(this.emailModel, (path) => {
    required(path.email, { message: $localize`:@@identityEmailRequired:Enter an email you can verify.` });
    email(path.email, { message: $localize`:@@identityEmailInvalid:Enter a valid email address.` });
  });

  readonly otpModel = signal<OtpModel>({ pin: '' });
  readonly otpForm: FieldTree<OtpModel> = form(this.otpModel, (path) => {
    required(path.pin, { message: $localize`:@@identityOtpRequired:Enter the 6-digit code.` });
    minLength(path.pin, 6, { message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    maxLength(path.pin, 6, { message: $localize`:@@identityOtpLength:Enter all 6 digits.` });
    pattern(path.pin, /^\d{6}$/, { message: $localize`:@@identityOtpDigits:Use the 6 digits from your email.` });
  });

  readonly enrollmentModel = signal<EnrollmentModel>({ label: '' });
  readonly enrollmentForm: FieldTree<EnrollmentModel> = form(this.enrollmentModel, (path) => {
    required(path.label, { message: $localize`:@@identityPasskeyLabelRequired:Name this passkey.` });
    maxLength(path.label, 64, { message: $localize`:@@identityPasskeyLabelLength:Use 64 characters or fewer.` });
  });

  readonly emailError = computed(() => this.emailForm.email().errors()[0]?.message ?? '');
  readonly passwordModel = signal<PasswordModel>({ email: '', password: '' });
  readonly passwordForm: FieldTree<PasswordModel> = form(this.passwordModel, (path) => {
    required(path.email, { message: $localize`:@@identityPasswordEmailRequired:Enter your email address.` });
    email(path.email, { message: $localize`:@@identityPasswordEmailInvalid:Enter a valid email address.` });
    required(path.password, { message: $localize`:@@identityPasswordRequired:Enter your password.` });
    maxLength(path.password, 512, { message: $localize`:@@identityPasswordLength:Use 512 characters or fewer.` });
  });
  readonly passwordEmailError = computed(() => this.passwordForm.email().errors()[0]?.message ?? '');
  readonly passwordError = computed(() => this.passwordForm.password().errors()[0]?.message ?? '');
  readonly passwordSetupModel = signal<PasswordSetupModel>({ password: '', confirmation: '' });
  readonly passwordSetupForm: FieldTree<PasswordSetupModel> = form(this.passwordSetupModel, (path) => {
    required(path.password, { message: $localize`:@@identityPasswordSetupRequired:Enter a password.` });
    minLength(path.password, 12, {
      message: $localize`:@@identityPasswordSetupLength:Use at least 12 characters.`,
    });
    maxLength(path.password, 512, {
      message: $localize`:@@identityPasswordSetupMaxLength:Use 512 characters or fewer.`,
    });
    required(path.confirmation, { message: $localize`:@@identityPasswordConfirmationRequired:Confirm your password.` });
    validate(path.confirmation, ({ value, valueOf }) =>
      value() === valueOf(path.password)
        ? undefined
        : { kind: 'password_mismatch', message: $localize`:@@identityPasswordMismatch:Passwords do not match.` },
    );
  });
  readonly passwordSetupError = computed(() => this.passwordSetupForm.password().errors()[0]?.message ?? '');
  readonly passwordConfirmationError = computed(() => this.passwordSetupForm.confirmation().errors()[0]?.message ?? '');
  readonly otpError = computed(() => this.otpForm.pin().errors()[0]?.message ?? '');
  readonly labelError = computed(() => this.enrollmentForm.label().errors()[0]?.message ?? '');

  constructor() {
    afterNextRender(() => void this.suggestPasskey());
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.passwordAttempt += 1;
      this.recoveryAttempt += 1;
      this.otpModel.set({ pin: '' });
      this.passwordModel.update((model) => ({ ...model, password: '' }));
      this.passwordSetupModel.set({ password: '', confirmation: '' });
      this.cancelCredential();
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      if (this.passwordSubmitting() && this.state() === 'password-factor') return;
      if (params.get('method') === 'password') {
        this.cancelCredential();
        this.closeMethods();
        this.state.set('password');
      } else if (this.state() === 'password' || this.state() === 'password-factor') {
        this.passwordAttempt += 1;
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

  private cancelCredential(): void {
    this.credentialAttempt += 1;
    this.credentialController?.abort();
    this.credentialController = undefined;
  }

  private prepareIdentityFlow(): ReturnType<Auth['startIdentityFlow']> {
    this.identityPreparation ??= this.auth
      .startIdentityFlow()
      .then((flow) => {
        this.identityFlowId.set(flow.flowId);

        return flow;
      })
      .finally(() => {
        this.identityPreparation = undefined;
      });

    return this.identityPreparation;
  }

  protected openMethods(): void {
    if (this.passkeyVerifying()) return;
    const immediate = this.immediateOptions;

    this.immediateOptions = undefined;
    this.cancelCredential();
    if (immediate && immediate.expiresAt > Date.now() + 5000) {
      this.passkeyVerifying.set(true);
      void this.authenticateImmediately(immediate);

      return;
    }
    this.showMethodSheet();
  }

  protected useAnotherMethod(): void {
    if (this.passkeyVerifying()) return;
    this.immediateOptions = undefined;
    this.cancelCredential();
    this.state.set('ready');
    this.showMethodSheet();
  }

  private async authenticateImmediately(begin: {
    challengeId: string;
    options: Record<string, unknown>;
  }): Promise<void> {
    const attempt = this.credentialAttempt;

    try {
      // Called directly by the click handler with prepared options to retain transient activation.
      const credential = await this.passkey.getImmediateCredential(begin.options);

      if (this.destroyed || attempt !== this.credentialAttempt) return;
      await this.passkey.completeAuthentication(begin.challengeId, credential);
      await this.auth.ensureSessionLoaded(true);
      if (!this.destroyed && attempt === this.credentialAttempt) await this.router.navigateByUrl(this.destination());
    } catch {
      if (!this.destroyed && attempt === this.credentialAttempt) this.showMethodSheet();
    } finally {
      this.passkeyVerifying.set(false);
    }
  }

  private showMethodSheet(): void {
    this.methodsOpen.set(true);
    this.errorMessage.set('');
    afterNextRender(
      () => {
        if (this.methodsOpen()) void this.showGoogle();
      },
      { injector: this.injector },
    );
  }

  protected closeMethods(): void {
    if (this.passkeyVerifying()) return;
    this.googleAttempt += 1;
    this.methodsOpen.set(false);
  }

  private async suggestPasskey(): Promise<void> {
    if (this.destroyed || this.state() !== 'ready' || this.methodsOpen() || this.passkeyVerifying()) return;
    const attempt = ++this.credentialAttempt;

    const [conditional, immediate] = await Promise.all([
      this.passkey.supportsConditionalAuthentication(),
      this.passkey.supportsImmediateAuthentication(),
    ]);

    if ((!conditional && !immediate) || attempt !== this.credentialAttempt) return;
    const controller = new AbortController();

    this.credentialController = controller;
    let credentialSelected = false;

    try {
      await this.prepareIdentityFlow();
      if (attempt !== this.credentialAttempt) return;
      const begin = await this.passkey.beginAuthentication();

      if (attempt !== this.credentialAttempt || !begin.options || !begin.challengeId) return;
      if (immediate && begin.expiresAt) {
        this.immediateOptions = {
          challengeId: begin.challengeId,
          options: begin.options,
          expiresAt: Date.parse(begin.expiresAt),
        };
      }
      if (!conditional) return;
      const credential = await this.passkey.getCredential(begin.options, {
        mediation: 'conditional',
        signal: controller.signal,
      });

      if (attempt !== this.credentialAttempt) return;
      this.immediateOptions = undefined;
      credentialSelected = true;
      this.passkeyVerifying.set(true);
      await this.passkey.completeAuthentication(begin.challengeId, credential);
      await this.auth.ensureSessionLoaded(true);
      if (!this.destroyed) await this.router.navigateByUrl(this.destination());
    } catch {
      // Discovery may end silently, but a selected credential needs visible verification feedback.
      if (credentialSelected && !this.destroyed && attempt === this.credentialAttempt) {
        this.failPasskey($localize`:@@identityPasskeyFailed:We could not verify that passkey.`);
      }
    } finally {
      if (attempt === this.credentialAttempt) {
        this.passkeyVerifying.set(false);
        this.credentialController = undefined;
      }
    }
  }

  protected async authenticateWithPasskey(): Promise<void> {
    if (this.state() === 'passkey-loading' || this.passkeyVerifying()) return;
    this.cancelCredential();
    this.closeMethods();
    const attempt = this.credentialAttempt;
    const controller = new AbortController();

    this.credentialController = controller;

    if (!this.passkey.isSupported()) {
      this.failPasskey($localize`:@@identityPasskeyUnsupported:This browser cannot use a passkey here.`);

      return;
    }

    const retryRequested = this.state() === 'passkey-error';

    this.state.set('passkey-loading');
    this.errorMessage.set('');

    try {
      await this.prepareIdentityFlow();
      if (attempt !== this.credentialAttempt) return;
      const begin = await this.passkey.beginAuthentication(retryRequested);

      if (!begin.options || !begin.challengeId) {
        throw new Error('Passkey options were not returned.');
      }

      if (attempt !== this.credentialAttempt) return;
      const credential = await this.passkey.getCredential(begin.options, { signal: controller.signal });

      if (attempt !== this.credentialAttempt) return;
      this.passkeyVerifying.set(true);
      await this.passkey.completeAuthentication(begin.challengeId, credential);
      await this.auth.ensureSessionLoaded(true);
      if (this.destroyed) return;
      this.state.set('success');
      await this.router.navigateByUrl(this.destination());
    } catch (error) {
      if (attempt !== this.credentialAttempt) return;
      this.failPasskey(
        error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')
          ? $localize`:@@identityPasskeyIncomplete:Passkey sign-in was not completed. Try again or use another method.`
          : $localize`:@@identityPasskeyFailed:We could not verify that passkey.`,
      );
    } finally {
      if (attempt === this.credentialAttempt) this.passkeyVerifying.set(false);
    }
  }

  protected async showGoogle(): Promise<void> {
    if (this.passkeyVerifying()) return;
    this.cancelCredential();
    const attempt = ++this.googleAttempt;
    const active = () => !this.destroyed && this.methodsOpen() && attempt === this.googleAttempt;

    try {
      const flow = await this.prepareIdentityFlow();

      if (!active()) return;
      this.identityFlowId.set(flow.flowId);
      if (!flow.google?.enabled || !flow.google.clientId || !flow.nonce || !this.googleButton()) return;
      this.googleClientId.set(flow.google.clientId);
      await this.google.renderButton(
        this.googleButton()!.nativeElement,
        flow.google.clientId,
        flow.flowId,
        flow.nonce,
        (user) => {
          void this.auth.ensureSessionLoaded(true).then(() => {
            if (!this.destroyed) return this.router.navigateByUrl(this.destination());

            return false;
          });
          this.state.set('success');
          this.selectedAccount.set(null);
          this.errorMessage.set('');
          void user;
        },
        () => {
          this.passkeyVerifying.set(false);
          if (active())
            this.errorMessage.set($localize`:@@identityGoogleFailed:Google sign-in is not available right now.`);
        },
        () => {
          if (!active()) return false;
          this.passkeyVerifying.set(true);

          return true;
        },
        active,
      );
    } catch (error) {
      if (!active()) return;
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityGoogleFailed:Google sign-in is not available right now.`),
      );
    }
  }

  protected showEmailRecovery(): void {
    if (this.passkeyVerifying()) return;
    this.cancelCredential();
    this.closeMethods();
    this.errorMessage.set('');

    if (!this.emailModel().email) {
      this.state.set('email');

      return;
    }

    void this.sendEmailOtp();
  }

  protected showPassword(): void {
    if (this.passkeyVerifying() || this.passwordSubmitting()) return;
    this.cancelCredential();
    this.closeMethods();
    this.errorMessage.set('');
    this.passwordAttempt += 1;
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

  protected async signInWithPassword(): Promise<void> {
    if (this.passwordForm().invalid() || this.passwordSubmitting()) return;
    const attempt = ++this.passwordAttempt;

    this.errorMessage.set('');
    this.passwordSubmitting.set(true);
    this.state.set('password');

    try {
      const password = this.passwordForm.password().value();

      this.passwordModel.update((model) => ({ ...model, password: '' }));
      const pending = await this.password.signIn({
        email: this.passwordForm.email().value(),
        password,
      });

      if (attempt !== this.passwordAttempt) return;

      this.passwordFlow.set(pending);
      this.passwordFactor.set(pending.requiredFactor);
      this.flowId.set(pending.flowId);
      this.resendAvailableAt.set(pending.resendAvailableAt ?? '');
      this.clock.set(Date.now());
      this.verificationRestartRequired.set(false);
      this.verificationNotice.set('');
      this.otpModel.set({ pin: '' });
      this.passwordModel.update((model) => ({ ...model, password: '' }));
      this.state.set('password-factor');
    } catch (error) {
      if (attempt !== this.passwordAttempt) return;
      if (error instanceof HttpErrorResponse && error.error?.code === 'email_unverified') {
        await this.router.navigate([EMAIL_VERIFICATION_URL], {
          queryParams: { email: this.passwordForm.email().value() },
        });

        return;
      }
      this.state.set('password');
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityPasswordFailed:We could not sign in with that password.`),
      );
    } finally {
      if (attempt === this.passwordAttempt) this.passwordSubmitting.set(false);
    }
  }

  protected async verifyPassword(): Promise<void> {
    const flowId = this.flowId();
    const factor = this.passwordFactor();

    if (
      !flowId ||
      !factor ||
      this.otpForm().invalid() ||
      this.passwordSubmitting() ||
      this.verificationRestartRequired()
    )
      return;
    const attempt = this.passwordAttempt;

    this.errorMessage.set('');
    this.passwordSubmitting.set(true);
    this.state.set('password-factor');

    try {
      await this.password.verify(flowId, this.otpForm.pin().value(), factor);
      if (this.destroyed || attempt !== this.passwordAttempt) return;
      await this.auth.ensureSessionLoaded(true);
      if (this.destroyed || attempt !== this.passwordAttempt) return;
      this.state.set('success');
      await this.router.navigateByUrl(this.destination());
    } catch (error) {
      if (this.destroyed || attempt !== this.passwordAttempt) return;
      this.state.set('password-factor');
      this.errorMessage.set(this.verificationError(error));
    } finally {
      if (attempt === this.passwordAttempt) this.passwordSubmitting.set(false);
    }
  }

  protected async resendPasswordCode(): Promise<void> {
    const flowId = this.flowId();

    if (
      !flowId ||
      this.passwordFactor() !== 'email' ||
      this.passwordSubmitting() ||
      this.resendSeconds() > 0 ||
      this.verificationRestartRequired()
    )
      return;
    const attempt = this.passwordAttempt;

    this.errorMessage.set('');
    this.verificationNotice.set('');
    this.passwordSubmitting.set(true);

    try {
      const response = await this.password.resend(flowId);

      if (this.destroyed || attempt !== this.passwordAttempt) return;
      this.resendAvailableAt.set(response.resendAvailableAt ?? '');
      this.clock.set(Date.now());
      this.verificationNotice.set($localize`:@@accessCodeResent:We sent a new code. Check your email.`);
    } catch (error) {
      if (this.destroyed || attempt !== this.passwordAttempt) return;
      if (error instanceof HttpErrorResponse && error.status === 429) {
        const retryAfter = error.headers.get('Retry-After');
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const deadline = Number.isFinite(seconds)
          ? Date.now() + Math.max(0, seconds) * 1000
          : Date.parse(retryAfter ?? '');

        if (Number.isFinite(deadline)) this.resendAvailableAt.set(new Date(deadline).toISOString());
        this.clock.set(Date.now());
      }
      this.errorMessage.set(
        this.verificationError(
          error,
          $localize`:@@identityPasswordResendFailed:We could not resend the verification code.`,
        ),
      );
    } finally {
      if (attempt === this.passwordAttempt) this.passwordSubmitting.set(false);
    }
  }

  protected showReady(): void {
    if (this.passwordSubmitting() || this.recoverySubmitting() || this.passkeyVerifying()) return;
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
    if (this.emailForm().invalid()) return;

    await this.sendEmailOtp();
  }

  private async sendEmailOtp(): Promise<void> {
    if (this.recoverySubmitting()) return;
    const attempt = ++this.recoveryAttempt;

    this.recoverySubmitting.set(true);
    this.errorMessage.set('');
    this.verificationRestartRequired.set(false);

    try {
      const email = this.emailForm.email().value();
      const started = await this.auth.startIdentityFlow();
      const flowId = started.flowId;

      if (this.destroyed || attempt !== this.recoveryAttempt) return;
      await this.auth.identifyIdentity(flowId, email);
      if (this.destroyed || attempt !== this.recoveryAttempt) return;
      await this.auth.requestIdentityRecovery(flowId, email);

      if (this.destroyed || attempt !== this.recoveryAttempt) return;
      this.identityFlowId.set(flowId);
      this.flowId.set(flowId);
      this.resendAvailableAt.set('');
      this.otpModel.set({ pin: '' });
      this.state.set('otp');
    } catch (error) {
      if (this.destroyed || attempt !== this.recoveryAttempt) return;
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityEmailFailed:We could not send a code yet. Try again.`),
      );
    } finally {
      if (attempt === this.recoveryAttempt) this.recoverySubmitting.set(false);
    }
  }

  protected changeRecoveryEmail(): void {
    if (this.recoverySubmitting()) return;
    this.recoveryAttempt += 1;
    this.identityFlowId.set('');
    this.flowId.set('');
    this.otpModel.set({ pin: '' });
    this.errorMessage.set('');
    this.verificationRestartRequired.set(false);
    this.state.set('email');
    afterNextRender(() => this.document.getElementById('identity-email')?.focus(), { injector: this.injector });
  }

  protected async verifyCode(): Promise<void> {
    if (this.otpForm().invalid() || !this.flowId() || this.recoverySubmitting() || this.verificationRestartRequired())
      return;
    const attempt = this.recoveryAttempt;

    this.recoverySubmitting.set(true);
    this.errorMessage.set('');

    try {
      await this.auth.verifyIdentityRecovery(this.flowId(), this.otpForm.pin().value());
      if (this.destroyed || attempt !== this.recoveryAttempt) return;

      const accounts = await this.auth.getRestrictedAccounts();

      if (this.destroyed || attempt !== this.recoveryAttempt) return;
      this.accounts.set(accounts);
      const selected = accounts.find((account) => account.selected) ?? null;

      this.selectedAccount.set(selected);
      this.state.set(selected ? 'password-setup' : 'account-choice');
    } catch (error) {
      if (this.destroyed || attempt !== this.recoveryAttempt) return;
      const accounts = this.accountChoices(error);

      if (accounts) {
        this.accounts.set(accounts);
        this.state.set('account-choice');

        return;
      }
      this.errorMessage.set(this.verificationError(error));
    } finally {
      if (attempt === this.recoveryAttempt) this.recoverySubmitting.set(false);
    }
  }

  protected async chooseAccount(account: RestrictedAccount): Promise<void> {
    try {
      const selected = await this.auth.selectRestrictedAccount(account.accountId);

      this.selectedAccount.set(selected);
      this.state.set('password-setup');
    } catch (error) {
      this.errorMessage.set(this.safeError(error, 'We could not select that account.'));
    }
  }

  protected skipPasswordSetup(): void {
    this.errorMessage.set('');
    this.state.set('enrollment');
  }

  protected async setPassword(): Promise<void> {
    if (this.passwordSetupForm().invalid() || this.passwordSetupSubmitting()) return;

    this.errorMessage.set('');
    this.passwordSetupSubmitting.set(true);
    this.state.set('password-setup-loading');

    try {
      await this.password.setPassword({ password: this.passwordSetupForm.password().value() });
      this.passwordSetupModel.set({ password: '', confirmation: '' });
      this.state.set('password-setup-success');
    } catch (error) {
      this.state.set('password-setup');
      this.errorMessage.set(
        this.safeError(error, $localize`:@@identityPasswordSetupFailed:We could not set your password. Try again.`),
      );
    } finally {
      this.passwordSetupSubmitting.set(false);
    }
  }

  protected continueToPasskeyEnrollment(): void {
    this.errorMessage.set('');
    this.state.set('enrollment');
  }

  protected async createPasskey(): Promise<void> {
    if (this.enrollmentForm().invalid()) return;

    this.errorMessage.set('');
    this.state.set('enrollment-loading');

    try {
      const begin = await this.passkey.beginRegistration(this.enrollmentForm.label().value());

      if (!begin.options || !begin.challengeId) {
        throw new Error('Passkey options were not returned.');
      }

      const credential = await this.passkey.createCredential(begin.options);

      const completed = await this.passkey.completeRegistration(begin.challengeId, credential);
      const verification = completed.restrictedSession;

      if (!verification?.verificationChallengeId || !verification.verificationOptions) {
        throw new Error('Passkey verification options were not returned.');
      }

      this.verificationChallengeId.set(verification.verificationChallengeId);
      this.verificationOptions.set(verification.verificationOptions);
      this.state.set('verification');
    } catch (error) {
      this.state.set('enrollment');
      this.errorMessage.set(
        error instanceof DOMException && error.name === 'AbortError'
          ? $localize`:@@identityEnrollmentCancelled:Passkey setup was cancelled. You can try again.`
          : this.safeError(error, $localize`:@@identityEnrollmentFailed:We could not create and verify that passkey.`),
      );
    }
  }

  protected async verifyNewPasskey(): Promise<void> {
    const challengeId = this.verificationChallengeId();
    const options = this.verificationOptions();

    if (!challengeId || !options) return;

    this.state.set('verification-loading');

    try {
      const assertion = await this.passkey.getCredential(options);

      await this.passkey.verifyRegistration(challengeId, assertion);
      await this.auth.ensureSessionLoaded(true);
      this.state.set('success');
      await this.router.navigateByUrl(this.destination());
    } catch (error) {
      this.state.set('verification');
      this.errorMessage.set(this.safeError(error, 'We could not verify the new passkey. Try again.'));
    }
  }

  private failPasskey(message: string): void {
    this.errorMessage.set(message);
    this.state.set('passkey-error');
  }

  private safeError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.status === 429)
      return $localize`:@@accessRateLimited:Too many attempts. Wait a moment before trying again.`;

    return fallback;
  }

  private verificationError(
    error: unknown,
    fallback = $localize`:@@identityOtpFailed:That code is not valid. Check it and try again.`,
  ): string {
    if (error instanceof HttpErrorResponse) {
      const code: unknown = error.error?.code;

      if (code === 'challenge_expired' || code === 'challenge_attempt_limit' || code === 'password_factor_invalid') {
        this.verificationRestartRequired.set(true);

        return $localize`:@@accessVerificationRestart:This verification can no longer continue. Start again to get a new code.`;
      }
      if (error.status === 0)
        return $localize`:@@accessVerificationOffline:We could not connect. Check your connection and try again.`;
    }

    return this.safeError(error, fallback);
  }

  private accountChoices(error: unknown): RestrictedAccount[] | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== 409 || error.error?.code !== 'multiple_accounts')
      return null;
    const accounts = error.error?.data?.accounts;

    return Array.isArray(accounts) ? accounts : null;
  }
}
