import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Session } from '../session/session';
import { destination } from '../session/navigation';

export class Action {
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  private readonly destroyRef = inject(DestroyRef);

  readonly busy = signal(true);
  readonly error = signal('');
  readonly errorFocus = signal(0);
  readonly notice = signal('');

  private alive = true;

  constructor() {
    // Native controls remain disabled until their form bindings are hydrated.
    afterNextRender(() => this.busy.set(false));
    this.destroyRef.onDestroy(() => {
      this.alive = false;
    });
  }

  async run(work: () => Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!this.alive || this.busy() || signal?.aborted) {
      return;
    }

    this.busy.set(true);
    this.error.set('');
    this.notice.set('');

    try {
      await work();
    } catch (error) {
      if (!this.alive || signal?.aborted) {
        return;
      }

      const code: unknown = error instanceof HttpErrorResponse ? error.error?.error : null;

      if (code === 'reauthentication_required' && !this.session.full()) {
        this.error.set(
          $localize`:@@authRestrictedExpired:This verification can no longer continue. Sign out and start recovery again.`,
        );
        this.errorFocus.update((value) => value + 1);
      } else if (code === 'reauthentication_required') {
        await this.router.navigate(['/auth/reauthenticate'], { queryParams: { returnTo: this.router.url } });
      } else if (
        code === 'account_verification_required' ||
        code === 'anonymous_session_required' ||
        code === 'authentication_required' ||
        code === 'session_expired'
      ) {
        await this.session.load(true);

        await this.router.navigateByUrl(destination(this.session.snapshot()));
      } else {
        this.error.set(errorMessage(error));
        this.errorFocus.update((value) => value + 1);
      }
    } finally {
      if (this.alive && !signal?.aborted) {
        this.busy.set(false);
      }
    }
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'authentication_unavailable') {
    return $localize`:@@authUnavailable:We could not connect to authentication. Check your connection and try again.`;
  }

  if (error instanceof Error && ['NotAllowedError', 'AbortError'].includes(error.name)) {
    return $localize`:@@authCancelled:The request was cancelled or no credential was selected. Try again or choose another method.`;
  }

  if (
    error instanceof Error &&
    (error.message === 'passkey_unavailable' || ['NotSupportedError', 'SecurityError'].includes(error.name))
  ) {
    return $localize`:@@authPasskeyUnavailable:Passkeys are not available in this browser or at this address. Choose another sign-in method.`;
  }

  if (error instanceof HttpErrorResponse) {
    const code: unknown = error.error?.error;

    if (error.status === 0 || error.status >= 500) {
      return $localize`:@@authUnavailable:We could not connect to authentication. Check your connection and try again.`;
    }

    if (error.status === 429) {
      return $localize`:@@authRateLimited:Too many attempts. Wait a moment before trying again.`;
    }

    if (code === 'csrf_invalid') {
      return $localize`:@@authCsrf:Your session changed. Try the action again.`;
    }

    if (error.status === 409) {
      return $localize`:@@authConflict:This change is not available. Keep at least one working sign-in method and refresh your account before trying again.`;
    }

    return $localize`:@@authProofInvalid:We could not verify these details. Check them and try again. If the request expired, start again.`;
  }

  return $localize`:@@authOperationFailed:We could not complete this action. Try again or choose another method.`;
}
