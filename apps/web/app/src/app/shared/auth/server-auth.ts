import { HttpClient } from '@angular/common/http';
import { REQUEST, computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Auth, type SignInWithPasswordResult } from './auth';
import { AUTH_REQUEST_CONTEXT } from './auth-request-context.token';
import type {
  AuthChallenge,
  AuthUser,
  ChallengeOrAuthenticatedResponse,
  ChallengeResponse,
  CredentialsPayload,
  SessionResponse,
} from './auth.models';

@Injectable()
export class ServerAuth extends Auth {
  private readonly http = inject(HttpClient);
  private readonly request = inject(REQUEST, { optional: true });
  private readonly requestContext = inject(AUTH_REQUEST_CONTEXT, { optional: true });

  private readonly $pendingChallenge = signal<AuthChallenge | null>(null);
  private readonly $sessionLoaded = signal(false);
  private readonly $submitting = signal(false);
  private readonly $user = signal<AuthUser | null>(this.requestContext?.user ?? null);
  private readonly $verificationSubmitting = signal(false);

  readonly isAuthenticated = computed(() => this.$user() !== null);
  readonly pendingChallenge = this.$pendingChallenge.asReadonly();
  readonly sessionLoaded = this.$sessionLoaded.asReadonly();
  readonly submitting = this.$submitting.asReadonly();
  readonly user = this.$user.asReadonly();
  readonly verificationSubmitting = this.$verificationSubmitting.asReadonly();

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

  async signInWithPassword(payload: CredentialsPayload): Promise<SignInWithPasswordResult> {
    this.$submitting.set(true);

    try {
      const response = await firstValueFrom(
        this.http.post<ChallengeOrAuthenticatedResponse>('/api/auth/sign-in/password', payload),
      );

      if ('authenticated' in response.data) {
        this.$user.set(response.data.user);
        this.$sessionLoaded.set(true);
        this.setPendingChallenge(null);

        return response.data;
      }

      this.setPendingChallenge({
        ...response.data,
        rememberDevice: payload.rememberDevice ?? false,
      });

      return response.data;
    } finally {
      this.$submitting.set(false);
    }
  }

  async signUp(payload: CredentialsPayload): Promise<AuthChallenge> {
    this.$submitting.set(true);

    try {
      const response = await firstValueFrom(this.http.post<ChallengeResponse>('/api/auth/sign-up', payload));

      this.setPendingChallenge(response.data);

      return response.data;
    } finally {
      this.$submitting.set(false);
    }
  }

  async submitVerification(pin: string): Promise<AuthUser> {
    const challenge = this.$pendingChallenge();

    if (!challenge) {
      throw new Error('No pending verification challenge is available.');
    }

    this.$verificationSubmitting.set(true);

    try {
      const endpoint = challenge.purpose === 'sign_in' ? '/api/auth/sign-in/verify' : '/api/auth/sign-up/verify';

      const response = await firstValueFrom(
        this.http.post<{ data: { user: AuthUser } }>(endpoint, {
          challengeId: challenge.challengeId,
          pin,
          rememberDevice: challenge.purpose === 'sign_in' ? (challenge.rememberDevice ?? false) : false,
        }),
      );

      this.$user.set(response.data.user);
      this.$sessionLoaded.set(true);
      this.setPendingChallenge(null);

      return response.data.user;
    } finally {
      this.$verificationSubmitting.set(false);
    }
  }

  async resendVerification(): Promise<AuthChallenge> {
    const challenge = this.$pendingChallenge();

    if (!challenge) {
      throw new Error('No pending verification challenge is available.');
    }

    const response = await firstValueFrom(
      this.http.post<ChallengeResponse>('/api/auth/verification/resend', {
        challengeId: challenge.challengeId,
      }),
    );

    this.setPendingChallenge(response.data);

    return response.data;
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/sign-out', {}, { responseType: 'text' }));

    this.$user.set(null);
    this.setPendingChallenge(null);
    this.$sessionLoaded.set(true);
  }

  async requestPasswordReset(email: string): Promise<AuthChallenge | null> {
    const response = await firstValueFrom(
      this.http.post<{ data: AuthChallenge | null }>('/api/auth/password/forgotten', { email }),
    );

    return response.data;
  }

  async verifyPasswordReset(challengeId: string, pin: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/password/reset/verify', { challengeId, pin }));
  }

  async submitPasswordReset(password: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/password/reset', { password }, { responseType: 'text' }));
  }

  clearPendingChallenge(): void {
    this.setPendingChallenge(null);
  }

  setPendingVerification(challenge: AuthChallenge): void {
    this.setPendingChallenge(challenge);
  }

  private hasSessionCookie(): boolean {
    const cookieHeader = this.request?.headers.get('cookie');

    return cookieHeader?.split(';').some((cookie) => cookie.trim().startsWith('connect.sid=')) ?? false;
  }

  private setPendingChallenge(challenge: AuthChallenge | null): void {
    this.$pendingChallenge.set(challenge);
  }
}
