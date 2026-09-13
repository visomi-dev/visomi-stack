import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { AuthUser, FullSession, ResponseEnvelope } from './auth.models';

export type PasswordSignInRequest = {
  email: string;
  password: string;
};

export type PasswordSetRequest = { password: string };
export type PasswordSetResponse = { passwordSet: true };
export type PasswordSignUpRequest = { email: string; password: string };
export type PasswordSignUpPending = { flowId: string; expiresAt: string; resendAvailableAt: string };
export type PasswordSignUpVerification = {
  authenticated: false;
  kind: 'restricted';
  expiresAt: string;
  user: null;
  verifiedEmail: string;
};
export type PasswordResetRequestResponse = {
  flowId: string;
  requiredFactor: 'email' | 'totp_or_recovery';
  expiresAt: string;
};
export type PasswordResetFactor = { kind: 'totp' | 'recovery_code'; code: string };
export type PasswordResetCompleteRequest = {
  flowId: string;
  emailCode: string;
  password: string;
  factor?: PasswordResetFactor;
};

export type PasswordSecondFactor = 'email' | 'totp';

export type PasswordSignInPending = {
  flowId: string;
  requiredFactor: PasswordSecondFactor;
  expiresAt: string;
  resendAvailableAt?: string;
  maskedEmail?: string;
};

export type PasswordVerification = FullSession;

export type TotpSetup = {
  enrollmentId: string;
  secret: string;
};

@Injectable({ providedIn: 'root' })
export class PasswordAuth {
  private readonly http = inject(HttpClient);

  async signIn(request: PasswordSignInRequest): Promise<PasswordSignInPending> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<PasswordSignInPending>>('/api/auth/password/sign-in', request),
    );

    return response.data;
  }

  async signUp(request: PasswordSignUpRequest): Promise<PasswordSignUpPending> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<PasswordSignUpPending>>('/api/auth/password/sign-up', request),
    );

    return response.data;
  }

  async verifySignUp(flowId: string, code: string): Promise<PasswordSignUpVerification> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<PasswordSignUpVerification>>('/api/auth/password/sign-up/verify', {
        flowId,
        code,
      }),
    );

    return response.data;
  }

  async requestReset(email: string): Promise<PasswordResetRequestResponse> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<PasswordResetRequestResponse>>('/api/auth/password/reset/request', { email }),
    );

    return response.data;
  }

  async completeReset(request: PasswordResetCompleteRequest): Promise<{ passwordReset: true }> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<{ passwordReset: true }>>('/api/auth/password/reset/complete', request),
    );

    return response.data;
  }

  async setPassword(request: PasswordSetRequest): Promise<PasswordSetResponse> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<PasswordSetResponse>>('/api/auth/password/set', request),
    );

    return response.data;
  }

  async verify(
    flowId: string,
    code: string,
    kind: PasswordSecondFactor | 'recovery_code',
  ): Promise<PasswordVerification> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<{ authenticated: true; user: AuthUser }>>('/api/auth/password/verify', {
        flowId,
        code,
        kind,
      }),
    );

    return { authenticated: response.data.authenticated, kind: 'full', user: response.data.user };
  }

  async resend(flowId: string): Promise<Pick<PasswordSignInPending, 'resendAvailableAt'>> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<Pick<PasswordSignInPending, 'resendAvailableAt'>>>('/api/auth/password/resend', {
        flowId,
      }),
    );

    return response.data;
  }

  async startTotpSetup(): Promise<TotpSetup> {
    const response = await firstValueFrom(this.http.post<ResponseEnvelope<TotpSetup>>('/api/auth/totp/setup', {}));

    return response.data;
  }

  async confirmTotp(enrollmentId: string, code: string): Promise<{ enabled: true; recoveryCodes: string[] }> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<{ enabled: true; recoveryCodes: string[] }>>('/api/auth/totp/confirm', {
        enrollmentId,
        code,
      }),
    );

    return response.data;
  }
}
