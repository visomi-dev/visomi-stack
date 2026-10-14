import type { Router } from '@angular/router';

import type { Auth } from '../../shared/auth/auth';
import type { Passkey } from '../../shared/auth/passkey';

import { SignInModel } from './sign-in-model';

export class SignInEnrollment {
  constructor(
    private readonly model: SignInModel,
    private readonly auth: Auth,
    private readonly passkey: Passkey,
    private readonly router: Router,
    private readonly destination: () => string,
  ) {}

  async createPasskey(): Promise<void> {
    if (this.model.enrollmentForm().invalid()) {
      return;
    }

    this.model.errorMessage.set('');
    this.model.state.set('enrollment-loading');

    try {
      const begin = await this.passkey.beginRegistration(this.model.enrollmentForm.label().value());

      if (!begin.options || !begin.challengeId) {
        throw new Error('Passkey options were not returned.');
      }

      const credential = await this.passkey.createCredential(begin.options);

      const completed = await this.passkey.completeRegistration(begin.challengeId, credential);
      const verification = completed.restrictedSession;

      if (!verification?.verificationChallengeId || !verification.verificationOptions) {
        throw new Error('Passkey verification options were not returned.');
      }

      this.model.verificationChallengeId.set(verification.verificationChallengeId);
      this.model.verificationOptions.set(verification.verificationOptions);
      this.model.state.set('verification');
    } catch (error) {
      this.model.state.set('enrollment');
      this.model.errorMessage.set(
        error instanceof DOMException && error.name === 'AbortError'
          ? $localize`:@@identityEnrollmentCancelled:Passkey setup was cancelled. You can try again.`
          : this.model.safeError(
              error,
              $localize`:@@identityEnrollmentFailed:We could not create and verify that passkey.`,
            ),
      );
    }
  }

  async verifyNewPasskey(): Promise<void> {
    const challengeId = this.model.verificationChallengeId();
    const options = this.model.verificationOptions();

    if (!challengeId || !options) {
      return;
    }

    this.model.state.set('verification-loading');

    try {
      const assertion = await this.passkey.getCredential(options);

      await this.passkey.verifyRegistration(challengeId, assertion);
      await this.auth.ensureSessionLoaded(true);
      this.model.state.set('success');
      await this.router.navigateByUrl(this.destination());
    } catch (error) {
      this.model.state.set('verification');
      this.model.errorMessage.set(this.model.safeError(error, 'We could not verify the new passkey. Try again.'));
    }
  }
}
