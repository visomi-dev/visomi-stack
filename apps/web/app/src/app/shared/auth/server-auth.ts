import { HttpClient } from '@angular/common/http';
import { REQUEST, computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Auth } from './auth';
import { AUTH_REQUEST_CONTEXT } from './auth-request-context.token';
import type {
  AuthUser,
  EmailOtpRequestPayload,
  EmailOtpResendPayload,
  EmailOtpResponse,
  EmailOtpVerifyPayload,
  RememberDevicePayload,
  SessionResponse,
  SessionUpgrade,
} from './auth.models';

@Injectable()
export class ServerAuth extends Auth {
  private readonly http = inject(HttpClient);
  private readonly request = inject(REQUEST, { optional: true });
  private readonly requestContext = inject(AUTH_REQUEST_CONTEXT, { optional: true });

  private readonly $sessionLoaded = signal(false);
  private readonly $user = signal<AuthUser | null>(this.requestContext?.user ?? null);
  private readonly $emailOtpSubmitting = signal(false);
  private readonly $passkeySubmitting = signal(false);

  readonly emailOtpSubmitting = this.$emailOtpSubmitting.asReadonly();
  readonly isAuthenticated = computed(() => this.$user() !== null);
  readonly passkeySubmitting = this.$passkeySubmitting.asReadonly();
  readonly sessionLoaded = this.$sessionLoaded.asReadonly();
  readonly user = this.$user.asReadonly();

  async ensureSessionLoaded(): Promise<void> {
    if (this.$sessionLoaded()) {
      return;
    }

    if (this.requestContext !== null && this.requestContext !== undefined) {
      this.$user.set(this.requestContext.user);
      this.$sessionLoaded.set(true);

      return;
    }

    if (!this.hasSessionCookie()) {
      this.$user.set(null);
      this.$sessionLoaded.set(true);

      return;
    }

    try {
      const response = await firstValueFrom(this.http.get<SessionResponse>('/api/auth/session'));

      this.$user.set(response.data.user);
    } catch {
      this.$user.set(null);
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

  async resendEmailOtp(payload: EmailOtpResendPayload): Promise<EmailOtpResponse['data']> {
    const response = await firstValueFrom(this.http.post<EmailOtpResponse>('/api/auth/email-otp/resend', payload));

    return response.data;
  }

  async selectRestrictedAccount(_payload: { flowId: string; accountId: string }): Promise<SessionUpgrade> {
    throw new Error('Account selection is only available in the browser.');
  }

  async rememberDevice(payload: RememberDevicePayload): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/sign-in/remember-device', payload, { responseType: 'text' }));
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/sign-out', {}, { responseType: 'text' }));

    this.$user.set(null);
    this.$sessionLoaded.set(true);
  }

  private hasSessionCookie(): boolean {
    const cookieHeader = this.request?.headers.get('cookie');

    return cookieHeader?.split(';').some((cookie) => cookie.trim().startsWith('connect.sid=')) ?? false;
  }
}
