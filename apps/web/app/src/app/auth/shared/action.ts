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

  setProcessing(active: boolean): void {
    if (this.destroyRef.destroyed) {
      return;
    }

    this.busyState.set(active);
    this.pendingState.set(active ? 'provider' : null);
  }

  setError(message: string): void {
    if (!this.destroyRef.destroyed) {
      this.errorState.set(message);
    }
  }

  setNotice(message: string): void {
    if (!this.destroyRef.destroyed) {
      this.noticeState.set(message);
    }
  }

  reset(): void {
    if (this.destroyRef.destroyed) {
      return;
    }

    this.busyState.set(false);
    this.pendingState.set(null);
    this.errorState.set('');
    this.noticeState.set('');
  }

  async run(work: () => Promise<void>, options: { signal?: AbortSignal; name?: string } = {}): Promise<void> {
    const { signal, name } = options;

    if (this.destroyRef.destroyed || this.busy() || signal?.aborted) {
      return;
    }

    this.busyState.set(true);
    this.pendingState.set(name ?? null);
    this.errorState.set('');
    this.noticeState.set('');

    try {
      await work();
    } catch (error) {
      if (this.destroyRef.destroyed || signal?.aborted) {
        return;
      }

      const code: unknown = error instanceof HttpErrorResponse ? error.error?.error : null;

      switch (code) {
        case 'reauthentication_required': {
          if (!this.session.full()) {
            this.errorState.set(
              $localize`:@@authRestrictedExpired:This verification can’t continue. Sign out and start recovery again.`,
            );

            this.errorFocusState.update((value) => value + 1);
          } else {
            const returnTo = safeReturnTo(this.router.url, this.location.prepareExternalUrl('/'));

            await this.router.navigate(['/auth/reauthenticate'], { queryParams: returnTo ? { returnTo } : {} });
          }

          break;
        }
        case 'account_verification_required':
        case 'anonymous_session_required':
        case 'authentication_required':
        case 'session_expired':
          await this.session.load(true);

          await this.router.navigateByUrl(destination(this.session.snapshot()));

          break;
        default:
          this.errorState.set(errorMessage(error));
          this.errorFocusState.update((value) => value + 1);
      }
    } finally {
      if (!this.destroyRef.destroyed && !signal?.aborted) {
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
    return $localize`:@@authUnavailable:Sign-in is temporarily unavailable. Try again later.`;
  }

  if (error instanceof Error && ['NotAllowedError', 'AbortError'].includes(error.name)) {
    return $localize`:@@authCancelled:The request was canceled or you didn’t select a credential. Try again or choose another way to sign in.`;
  }

  if (
    error instanceof Error &&
    (error.message === 'passkey_unavailable' || ['NotSupportedError', 'SecurityError'].includes(error.name))
  ) {
    return $localize`:@@authPasskeyUnavailable:You can’t use a passkey in this browser or at this address. Choose another way to sign in.`;
  }

  if (error instanceof HttpErrorResponse) {
    const code: unknown = error.error?.error;

    if (error.status === 0) {
      return $localize`:@@authNetworkError:We couldn’t connect to the sign-in service. Check your connection and try again.`;
    }

    if (error.status >= 500) {
      return $localize`:@@authUnavailable:Sign-in is temporarily unavailable. Try again later.`;
    }

    if (error.status === 429) {
      return $localize`:@@authRateLimited:Too many attempts. Wait a moment and try again.`;
    }

    if (code === 'csrf_invalid') {
      return $localize`:@@authCsrf:Your session changed. Try again.`;
    }

    if (error.status === 409) {
      return $localize`:@@authConflict:We couldn’t make this change. Keep a working sign-in method, refresh the page, and try again.`;
    }

    return $localize`:@@authProofInvalid:We couldn’t verify these details. Check them and try again. If the request expired, start again.`;
  }

  return $localize`:@@authOperationFailed:We couldn’t complete this action. Try again or choose another method.`;
}
