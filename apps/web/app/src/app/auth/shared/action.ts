import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Service, afterNextRender, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Session } from '../session/session';
import { destination, safeReturnTo } from '../session/navigation';

@Service({ autoProvided: false })
export class Action {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly session = inject(Session);
  private readonly destroyRef = inject(DestroyRef);

  private readonly busyState = signal(true);
  private readonly errorState = signal('');
  private readonly errorFocusState = signal(0);
  private readonly noticeState = signal('');
  private readonly pendingState = signal<string | null>(null);

  readonly busy = this.busyState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly errorFocus = this.errorFocusState.asReadonly();
  readonly notice = this.noticeState.asReadonly();
  readonly pending = this.pendingState.asReadonly();

  private alive = true;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.alive = false;
    });
  }

  setProcessing(active: boolean): void {
    if (!this.alive) {
      return;
    }

    this.busyState.set(active);

    if (!active) {
      this.pendingState.set(null);
    }
  }

  setError(message: string): void {
    if (this.alive) {
      this.errorState.set(message);
    }
  }

  setNotice(message: string): void {
    if (this.alive) {
      this.noticeState.set(message);
    }
  }

  reset(): void {
    if (!this.alive) {
      return;
    }

    this.busyState.set(false);
    this.pendingState.set(null);
    this.errorState.set('');
    this.noticeState.set('');
  }

  async run(work: () => Promise<void>, options: { signal?: AbortSignal; name?: string } = {}): Promise<void> {
    const { signal, name } = options;

    if (!this.alive || this.busy() || signal?.aborted) {
      return;
    }

    this.busyState.set(true);
    this.pendingState.set(name ?? null);
    this.errorState.set('');
    this.noticeState.set('');

    try {
      await work();
    } catch (error) {
      if (!this.alive || signal?.aborted) {
        return;
      }

      const code: unknown = error instanceof HttpErrorResponse ? error.error?.error : null;

      if (code === 'reauthentication_required' && !this.session.full()) {
        this.errorState.set(
          $localize`:@@authRestrictedExpired:This verification can no longer continue. Sign out and start recovery again.`,
        );
        this.errorFocusState.update((value) => value + 1);
      } else if (code === 'reauthentication_required') {
        const returnTo = safeReturnTo(this.router.url, this.location.prepareExternalUrl('/'));

        await this.router.navigate(['/auth/reauthenticate'], { queryParams: returnTo ? { returnTo } : {} });
      } else if (
        code === 'account_verification_required' ||
        code === 'anonymous_session_required' ||
        code === 'authentication_required' ||
        code === 'session_expired'
      ) {
        await this.session.load(true);

        await this.router.navigateByUrl(destination(this.session.snapshot()));
      } else {
        this.errorState.set(errorMessage(error));
        this.errorFocusState.update((value) => value + 1);
      }
    } finally {
      if (this.alive && !signal?.aborted) {
        this.busyState.set(false);
        this.pendingState.set(null);
      }
    }
  }

  // Native controls remain disabled until their form bindings are hydrated.
  private readonly initialize = afterNextRender(() => this.busyState.set(false));
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
