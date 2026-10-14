import type { Router } from '@angular/router';
import { DateTime } from 'luxon';

import type { Auth } from '../../shared/auth/auth';
import type { Passkey } from '../../shared/auth/passkey';

import { SignInModel } from './sign-in-model';

export class SignInPasskey {
  credentialController?: AbortController;
  credentialAttempt = 0;
  identityPreparation?: ReturnType<Auth['startIdentityFlow']>;
  immediateOptions?: { challengeId: string; options: Record<string, unknown>; expiresAt: number };

  constructor(
    private readonly model: SignInModel,
    private readonly auth: Auth,
    private readonly passkey: Passkey,
    private readonly router: Router,
    private readonly destination: () => string,
    private readonly closeMethods: () => void,
    private readonly showMethodSheet: () => void,
  ) {}

  async authenticateWithPasskey(): Promise<void> {
    if (this.model.state() === 'passkey-loading' || this.model.passkeyVerifying()) {
      return;
    }
    this.cancelCredential();
    this.closeMethods();
    const attempt = this.credentialAttempt;
    const controller = new AbortController();

    this.credentialController = controller;

    if (!this.passkey.isSupported()) {
      this.failPasskey($localize`:@@identityPasskeyUnsupported:This browser cannot use a passkey here.`);

      return;
    }

    const retryRequested = this.model.state() === 'passkey-error';

    this.model.state.set('passkey-loading');
    this.model.errorMessage.set('');

    try {
      await this.prepareIdentityFlow();
      if (attempt !== this.credentialAttempt) {
        return;
      }
      const begin = await this.passkey.beginAuthentication(retryRequested);

      if (!begin.options || !begin.challengeId) {
        throw new Error('Passkey options were not returned.');
      }

      if (attempt !== this.credentialAttempt) {
        return;
      }
      const credential = await this.passkey.getCredential(begin.options, { signal: controller.signal });

      if (attempt !== this.credentialAttempt) {
        return;
      }
      this.model.passkeyVerifying.set(true);
      await this.passkey.completeAuthentication(begin.challengeId, credential);
      await this.auth.ensureSessionLoaded(true);
      if (this.model.destroyed) {
        return;
      }
      this.model.state.set('success');
      await this.router.navigateByUrl(this.destination());
    } catch (error) {
      if (attempt !== this.credentialAttempt) {
        return;
      }
      this.failPasskey(
        error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')
          ? $localize`:@@identityPasskeyIncomplete:Passkey sign-in was not completed. Try again or use another method.`
          : $localize`:@@identityPasskeyFailed:We could not verify that passkey.`,
      );
    } finally {
      if (attempt === this.credentialAttempt) {
        this.model.passkeyVerifying.set(false);
      }
    }
  }

  cancelCredential(): void {
    this.credentialAttempt += 1;
    this.credentialController?.abort();
    this.credentialController = undefined;
  }

  prepareIdentityFlow(): ReturnType<Auth['startIdentityFlow']> {
    this.identityPreparation ??= this.auth
      .startIdentityFlow()
      .then((flow) => {
        this.model.identityFlowId.set(flow.flowId);

        return flow;
      })
      .finally(() => {
        this.identityPreparation = undefined;
      });

    return this.identityPreparation;
  }

  async authenticateImmediately(begin: { challengeId: string; options: Record<string, unknown> }): Promise<void> {
    const attempt = this.credentialAttempt;
    let credentialSelected = false;

    try {
      // Called directly by the click handler with prepared options to retain transient activation.
      const credential = await this.passkey.getImmediateCredential(begin.options);

      if (this.model.destroyed || attempt !== this.credentialAttempt) {
        return;
      }
      credentialSelected = true;
      await this.passkey.completeAuthentication(begin.challengeId, credential);
      await this.auth.ensureSessionLoaded(true);
      if (!this.model.destroyed && attempt === this.credentialAttempt) {
        this.model.state.set('success');
        await this.router.navigateByUrl(this.destination());
      }
    } catch {
      if (!this.model.destroyed && attempt === this.credentialAttempt) {
        if (credentialSelected) {
          this.failPasskey($localize`:@@identityPasskeyFailed:We could not verify that passkey.`);
        } else {
          this.showMethodSheet();
        }
      }
    } finally {
      this.model.passkeyVerifying.set(false);
    }
  }

  async suggestPasskey(): Promise<void> {
    if (
      this.model.destroyed ||
      this.model.state() !== 'ready' ||
      this.model.methodsOpen() ||
      this.model.passkeyVerifying()
    ) {
      return;
    }
    const attempt = ++this.credentialAttempt;

    const [conditional, immediate] = await Promise.all([
      this.passkey.supportsConditionalAuthentication(),
      this.passkey.supportsImmediateAuthentication(),
    ]);

    if ((!conditional && !immediate) || attempt !== this.credentialAttempt) {
      return;
    }
    const controller = new AbortController();

    this.credentialController = controller;
    let credentialSelected = false;

    try {
      await this.prepareIdentityFlow();
      if (attempt !== this.credentialAttempt) {
        return;
      }
      const begin = await this.passkey.beginAuthentication();

      if (attempt !== this.credentialAttempt || !begin.options || !begin.challengeId) {
        return;
      }
      if (immediate && begin.expiresAt) {
        this.immediateOptions = {
          challengeId: begin.challengeId,
          options: begin.options,
          expiresAt: DateTime.fromISO(begin.expiresAt).toMillis(),
        };
      }
      if (!conditional) {
        return;
      }
      const credential = await this.passkey.getCredential(begin.options, {
        mediation: 'conditional',
        signal: controller.signal,
      });

      if (attempt !== this.credentialAttempt) {
        return;
      }
      this.immediateOptions = undefined;
      credentialSelected = true;
      this.model.passkeyVerifying.set(true);
      await this.passkey.completeAuthentication(begin.challengeId, credential);
      await this.auth.ensureSessionLoaded(true);
      if (!this.model.destroyed && attempt === this.credentialAttempt) {
        this.model.state.set('success');
        await this.router.navigateByUrl(this.destination());
      }
    } catch {
      // Discovery may end silently, but a selected credential needs visible verification feedback.
      if (credentialSelected && !this.model.destroyed && attempt === this.credentialAttempt) {
        this.failPasskey($localize`:@@identityPasskeyFailed:We could not verify that passkey.`);
      }
    } finally {
      if (attempt === this.credentialAttempt) {
        this.model.passkeyVerifying.set(false);
        this.credentialController = undefined;
      }
    }
  }

  failPasskey(message: string): void {
    this.model.errorMessage.set(message);
    this.model.state.set('passkey-error');
  }
}
