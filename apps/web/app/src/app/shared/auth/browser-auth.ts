import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { SESSION_PRESENCE_KEY } from '../constants/storage';

import { Auth } from './auth';
import type {
  AuthUser,
  EmailOtpRequestPayload,
  EmailOtpResendPayload,
  EmailOtpResponse,
  EmailOtpVerifyPayload,
  SessionResponse,
  SessionUpgrade,
  RestrictedAccount,
  ResponseEnvelope,
  IdentityFlow,
} from './auth.models';

@Injectable({ providedIn: 'root' })
export class BrowserAuth extends Auth {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private readonly $sessionLoaded = signal(false);
  private readonly $user = signal<AuthUser | null>(null);
  private readonly $emailOtpSubmitting = signal(false);
  private readonly $passkeySubmitting = signal(false);

  readonly emailOtpSubmitting = this.$emailOtpSubmitting.asReadonly();
  readonly isAuthenticated = computed(() => this.$user() !== null);
  readonly passkeySubmitting = this.$passkeySubmitting.asReadonly();
  readonly sessionLoaded = this.$sessionLoaded.asReadonly();
  readonly user = this.$user.asReadonly();

  async startIdentityFlow(): Promise<IdentityFlow> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<IdentityFlow>>('/api/auth/identity/start', {}),
    );

    return response.data;
  }

  async ensureSessionLoaded(force = false): Promise<void> {
    if (this.$sessionLoaded() && !force) {
      return;
    }

    if (!force && !this.hasSessionHint()) {
      this.$user.set(null);
      this.$sessionLoaded.set(true);
      this.clearSessionHint();

      return;
    }

    try {
      const response = await firstValueFrom(this.http.get<SessionResponse>('/api/auth/session'));

      this.$user.set(response.data.user);

      if (response.data.user === null) {
        this.clearSessionHint();
      }
    } catch {
      this.$user.set(null);
      this.clearSessionHint();
    } finally {
      this.$sessionLoaded.set(true);
    }
  }

  async requestEmailOtp(payload: EmailOtpRequestPayload): Promise<EmailOtpResponse['data']> {
    this.$emailOtpSubmitting.set(true);

    try {
      const response = await firstValueFrom(this.http.post<EmailOtpResponse>('/api/auth/email-otp/request', payload));

      return response.data;
    } finally {
      this.$emailOtpSubmitting.set(false);
    }
  }

  async verifyEmailOtp(payload: EmailOtpVerifyPayload): Promise<SessionUpgrade> {
    this.$emailOtpSubmitting.set(true);

    try {
      const response = await firstValueFrom(
        this.http.post<{ data: SessionUpgrade }>('/api/auth/email-otp/verify', payload),
      );

      const session = response.data;

      this.$user.set(session.user);
      this.$sessionLoaded.set(true);

      return session;
    } finally {
      this.$emailOtpSubmitting.set(false);
    }
  }

  async getRestrictedAccounts(): Promise<RestrictedAccount[]> {
    const response = await firstValueFrom(
      this.http.get<ResponseEnvelope<{ accounts: RestrictedAccount[] }>>('/api/auth/restricted/accounts'),
    );

    return response.data.accounts;
  }

  async resendEmailOtp(payload: EmailOtpResendPayload): Promise<EmailOtpResponse['data']> {
    const response = await firstValueFrom(this.http.post<EmailOtpResponse>('/api/auth/email-otp/resend', payload));

    return response.data;
  }

  async selectRestrictedAccount(accountId: string): Promise<RestrictedAccount> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<RestrictedAccount>>('/api/auth/restricted/accounts/select', { accountId }),
    );

    return response.data;
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/sign-out', {}, { responseType: 'text' }));

    this.$user.set(null);
    this.$sessionLoaded.set(true);
    this.clearSessionHint();
  }

  private hasSessionHint(): boolean {
    return this.readCookie(SESSION_PRESENCE_KEY) === '1';
  }

  private clearSessionHint(): void {
    this.writeCookie(SESSION_PRESENCE_KEY, '', 'Thu, 01 Jan 1970 00:00:00 GMT');
  }

  private readCookie(name: string): string | null {
    const cookies = this.document.cookie ? this.document.cookie.split(';') : [];

    for (const cookie of cookies) {
      const [rawKey, ...rest] = cookie.trim().split('=');

      if (rawKey === name) {
        return rest.join('=');
      }
    }

    return null;
  }

  private writeCookie(name: string, value: string, expires: string): void {
    const parts = [`${name}=${value}`, 'Path=/', 'SameSite=Lax', `Expires=${expires}`];

    if (this.document.defaultView?.location.protocol === 'https:') {
      parts.push('Secure');
    }

    this.document.cookie = parts.join('; ');
  }
}
