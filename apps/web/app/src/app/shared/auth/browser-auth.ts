import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { PENDING_CHALLENGE_KEY, SESSION_PRESENCE_KEY } from '../constants/storage';

import { Auth, type SignInWithPasswordResult } from './auth';
import type {
  AuthChallenge,
  AuthUser,
  ChallengeOrAuthenticatedResponse,
  ChallengeResponse,
  CredentialsPayload,
  SessionResponse,
} from './auth.models';

@Injectable({ providedIn: 'root' })
export class BrowserAuth extends Auth {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private readonly $pendingChallenge = signal<AuthChallenge | null>(this.readStoredChallenge());
  private readonly $sessionLoaded = signal(false);
  private readonly $submitting = signal(false);
  private readonly $user = signal<AuthUser | null>(null);
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

    if (!this.hasSessionHint()) {
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
    this.clearSessionHint();
  }

  async requestPasswordReset(email: string): Promise<AuthChallenge | null> {
    const response = await firstValueFrom(
      this.http.post<{ data: AuthChallenge | null }>('/api/auth/password/forgotten', { email }),
    );

    if (response.data) {
      this.setPendingChallenge(response.data);
    }

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

  private readStoredChallenge(): AuthChallenge | null {
    const storedChallenge = this.document.defaultView?.sessionStorage.getItem(PENDING_CHALLENGE_KEY);

    if (!storedChallenge) {
      return null;
    }

    try {
      return JSON.parse(storedChallenge) as AuthChallenge;
    } catch {
      this.document.defaultView?.sessionStorage.removeItem(PENDING_CHALLENGE_KEY);

      return null;
    }
  }

  private setPendingChallenge(challenge: AuthChallenge | null): void {
    this.$pendingChallenge.set(challenge);

    const storage = this.document.defaultView?.sessionStorage;

    if (!storage) {
      return;
    }

    if (!challenge) {
      storage.removeItem(PENDING_CHALLENGE_KEY);

      return;
    }

    storage.setItem(PENDING_CHALLENGE_KEY, JSON.stringify(challenge));
  }
}
