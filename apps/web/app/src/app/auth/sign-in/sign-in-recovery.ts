import { Auth } from '../../shared/auth/auth';
import type { RestrictedAccount } from '../../shared/auth/auth.models';

import { SignInModel } from './sign-in-model';

export class SignInRecovery {
  constructor(
    private readonly model: SignInModel,
    private readonly auth: Auth,
  ) {}

  async verifyCode(): Promise<void> {
    if (
      this.model.state() !== 'otp' ||
      this.model.otpForm().invalid() ||
      !this.model.flowId() ||
      this.model.recoverySubmitting() ||
      this.model.verificationRestartRequired()
    ) {
      return;
    }
    const attempt = this.model.recoveryAttempt;

    this.model.recoverySubmitting.set(true);
    this.model.errorMessage.set('');

    try {
      const factor = this.model.recoveryFactorModel();

      await this.auth.verifyIdentityRecovery(
        this.model.flowId(),
        this.model.otpForm.pin().value(),
        factor.code.trim() ? { ...factor, code: factor.code.trim() } : undefined,
      );
      if (this.model.destroyed || attempt !== this.model.recoveryAttempt) {
        return;
      }
      this.model.state.set('accounts-loading');
      this.model.otpModel.set({ pin: '' });
      this.model.recoveryFactorModel.set({ kind: 'totp', code: '' });
    } catch (error) {
      if (this.model.destroyed || attempt !== this.model.recoveryAttempt) {
        return;
      }
      const accounts = this.model.accountChoices(error);

      if (accounts) {
        this.model.accounts.set(accounts);
        this.model.state.set('account-choice');

        return;
      }
      this.model.errorMessage.set(this.model.verificationError(error));
    } finally {
      if (attempt === this.model.recoveryAttempt) {
        this.model.recoverySubmitting.set(false);
      }
    }
    if (this.model.state() === 'accounts-loading') {
      await this.loadRecoveryAccounts();
    }
  }

  async loadRecoveryAccounts(): Promise<void> {
    if (this.model.state() !== 'accounts-loading' || this.model.recoverySubmitting()) {
      return;
    }
    const attempt = this.model.recoveryAttempt;

    this.model.recoverySubmitting.set(true);
    this.model.errorMessage.set('');
    try {
      const accounts = await this.auth.getRestrictedAccounts();

      if (this.model.destroyed || attempt !== this.model.recoveryAttempt) {
        return;
      }
      this.model.accounts.set(accounts);
      const selected = accounts.find((account) => account.selected) ?? null;

      this.model.selectedAccount.set(selected);
      this.model.state.set(selected ? 'password-setup' : 'account-choice');
    } catch {
      if (!this.model.destroyed && attempt === this.model.recoveryAttempt) {
        this.model.errorMessage.set(
          $localize`:@@identityAccountsLoadFailed:Your email was verified, but we could not load your accounts. Try loading them again.`,
        );
      }
    } finally {
      if (attempt === this.model.recoveryAttempt) {
        this.model.recoverySubmitting.set(false);
      }
    }
  }

  async chooseAccount(account: RestrictedAccount): Promise<void> {
    try {
      const selected = await this.auth.selectRestrictedAccount(account.accountId);

      this.model.selectedAccount.set(selected);
      this.model.state.set('password-setup');
    } catch (error) {
      this.model.errorMessage.set(this.model.safeError(error, 'We could not select that account.'));
    }
  }

  async sendEmailOtp(): Promise<void> {
    if (this.model.recoverySubmitting()) {
      return;
    }
    const attempt = ++this.model.recoveryAttempt;

    this.model.recoverySubmitting.set(true);
    this.model.errorMessage.set('');
    this.model.verificationRestartRequired.set(false);

    try {
      const email = this.model.emailForm.email().value();
      const started = await this.auth.startIdentityFlow();
      const flowId = started.flowId;

      if (this.model.destroyed || attempt !== this.model.recoveryAttempt) {
        return;
      }
      await this.auth.identifyIdentity(flowId, email);
      if (this.model.destroyed || attempt !== this.model.recoveryAttempt) {
        return;
      }
      await this.auth.requestIdentityRecovery(flowId, email);

      if (this.model.destroyed || attempt !== this.model.recoveryAttempt) {
        return;
      }
      this.model.identityFlowId.set(flowId);
      this.model.flowId.set(flowId);
      this.model.resendAvailableAt.set('');
      this.model.otpModel.set({ pin: '' });
      this.model.state.set('otp');
      this.model.recoveryFactorModel.set({ kind: 'totp', code: '' });
    } catch (error) {
      if (this.model.destroyed || attempt !== this.model.recoveryAttempt) {
        return;
      }
      this.model.errorMessage.set(
        this.model.safeError(error, $localize`:@@identityEmailFailed:We could not send a code yet. Try again.`),
      );
    } finally {
      if (attempt === this.model.recoveryAttempt) {
        this.model.recoverySubmitting.set(false);
      }
    }
  }
}
