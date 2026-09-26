import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';

import { Passkey } from './passkey';
import { SecurityAuth } from './security-auth';
import type { ReauthenticationPurpose, ReauthenticationStart } from './security-auth';

export type SecurityActionContext = { summary: string; targetId: string } & (
  | { authority: 'operation'; purpose: ReauthenticationPurpose }
  | { authority: 'passkey'; purpose: 'passkey_add' | 'passkey_rename' | 'passkey_revoke' | 'device_approve' }
);
export type ConfirmationMethod = ReauthenticationStart['methods'][number];

// Scoped to the route that owns the mutation, so navigation destroys pending work.
@Injectable()
export class SecurityAction {
  private readonly security = inject(SecurityAuth);
  private readonly passkey = inject(Passkey);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pendingState = signal<SecurityActionContext | null>(null);
  private readonly busyState = signal(false);
  private readonly errorState = signal('');
  private readonly methodsState = signal<ConfirmationMethod[]>([]);
  private readonly totpState = signal(false);
  private readonly googleState = signal<ReauthenticationStart['google']>(undefined);
  private grant: ReauthenticationStart | null = null;
  private attempt = 0;
  private controller?: AbortController;
  private execute?: (grantId: string) => Promise<void>;
  private dismiss?: () => void;
  readonly pending = this.pendingState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly methods = this.methodsState.asReadonly();
  readonly passwordRequiresTotp = this.totpState.asReadonly();
  readonly google = this.googleState.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => this.dispose());
  }

  run<T>(context: SecurityActionContext, mutation: (grantId: string) => Promise<T>): Promise<T | undefined> {
    if (this.pending()) return Promise.resolve(undefined);
    this.pendingState.set(context);
    this.errorState.set('');
    const attempt = ++this.attempt;

    const result = new Promise<T | undefined>((resolve, reject) => {
      this.dismiss = () => resolve(undefined);
      this.execute = async (grantId) => {
        try {
          resolve(await mutation(grantId));
        } catch (error) {
          reject(error);
        } finally {
          if (attempt === this.attempt) this.dispose();
        }
      };
    });

    void this.prepare(attempt);

    return result;
  }

  cancel(): void {
    if (!this.busy()) this.dispose();
  }

  async retry(): Promise<void> {
    if (!this.busy() && this.pending()) await this.prepare(this.attempt);
  }

  private async prepare(attempt: number): Promise<void> {
    const action = this.pending();

    if (!action) return;
    this.busyState.set(true);
    this.errorState.set('');
    this.methodsState.set([]);
    this.googleState.set(undefined);
    try {
      const grant = action.authority === 'operation' ? await this.security.startReauthentication(action.purpose) : null;

      if (attempt !== this.attempt) return;
      this.grant = grant;
      this.methodsState.set(grant ? grant.methods : ['passkey']);
      this.totpState.set(grant?.passwordRequiresTotp ?? false);
      this.googleState.set(grant?.google);
    } catch {
      if (attempt === this.attempt)
        this.errorState.set($localize`:@@securityConfirmationUnavailable:Confirmation is unavailable. Try again.`);
    } finally {
      if (attempt === this.attempt) this.busyState.set(false);
    }
  }

  async confirmGoogle(idToken: string, challenge: NonNullable<ReauthenticationStart['google']>): Promise<void> {
    if (this.google() !== challenge) return;
    await this.confirm('google', '', '', idToken);
  }

  async confirm(method: ConfirmationMethod, password = '', code = '', idToken?: string): Promise<void> {
    if (this.busy() || !this.pending() || !this.methods().includes(method)) return;
    if (this.grant && Date.parse(this.grant.expiresAt) <= Date.now()) {
      this.methodsState.set([]);
      this.errorState.set(
        $localize`:@@securityConfirmationExpired:Confirmation expired. Start a new confirmation to continue.`,
      );

      return;
    }
    const attempt = this.attempt;

    this.busyState.set(true);
    this.errorState.set('');
    try {
      if (method === 'passkey') {
        this.controller = new AbortController();
        const begin = await this.passkey.beginAuthentication();

        if (attempt !== this.attempt) return;
        if (!begin.options || !begin.challengeId) throw new Error('Missing passkey options');
        const credential = await this.passkey.getCredential(begin.options, { signal: this.controller.signal });

        if (attempt !== this.attempt) return;
        await this.passkey.completeAuthentication(begin.challengeId, credential);
      }
      if (attempt !== this.attempt) return;
      if (this.grant)
        await this.security.completeReauthentication({
          grantId: this.grant.grantId,
          method,
          password,
          code,
          ...(idToken ? { idToken } : {}),
        });
      if (attempt !== this.attempt) return;
      await this.execute?.(this.grant?.grantId ?? '');
    } catch (error) {
      if (attempt !== this.attempt) return;
      if (
        error instanceof HttpErrorResponse &&
        (error.status === 410 || error.error?.code === 'reauthentication_required')
      )
        this.methodsState.set([]);
      this.errorState.set(
        $localize`:@@securityConfirmationFailed:Identity confirmation was not completed. Try again or choose another available method.`,
      );
    } finally {
      if (attempt === this.attempt) this.busyState.set(false);
    }
  }

  private dispose(): void {
    this.attempt += 1;
    this.controller?.abort();
    this.controller = undefined;
    this.dismiss?.();
    this.dismiss = undefined;
    this.execute = undefined;
    this.grant = null;
    this.googleState.set(undefined);
    this.pendingState.set(null);
    this.methodsState.set([]);
    this.totpState.set(false);
    this.busyState.set(false);
    this.errorState.set('');
  }
}
