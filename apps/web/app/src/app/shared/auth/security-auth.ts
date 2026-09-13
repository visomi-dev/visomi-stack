import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { ResponseEnvelope } from './auth.models';

export type ReauthenticationPurpose =
  | 'password_change'
  | 'password_remove'
  | 'totp_change'
  | 'totp_disable'
  | 'recovery_codes_regenerate'
  | 'google_link';

export type ReauthenticationStart = {
  grantId: string;
  methods: Array<'passkey' | 'password' | 'totp' | 'recovery_code'>;
};
export type ReauthenticationComplete = { grantId: string; authenticated: true };
export type IdentityProviders = {
  google: { enabled: boolean; clientId: string | null };
  password: { enabled: boolean };
};

@Injectable({ providedIn: 'root' })
export class SecurityAuth {
  private readonly http = inject(HttpClient);

  async startReauthentication(purpose: ReauthenticationPurpose): Promise<ReauthenticationStart> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<ReauthenticationStart>>('/api/auth/reauth/start', { purpose }),
    );

    return response.data;
  }

  async completeReauthentication(request: {
    grantId: string;
    method: 'passkey' | 'google' | 'password' | 'totp' | 'recovery_code';
    code?: string;
    password?: string;
    idToken?: string;
  }): Promise<ReauthenticationComplete> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<ReauthenticationComplete>>('/api/auth/reauth/complete', request),
    );

    return response.data;
  }

  async regenerateRecoveryCodes(grantId: string): Promise<string[]> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<{ recoveryCodes: string[] }>>('/api/auth/recovery-codes/regenerate', { grantId }),
    );

    return response.data.recoveryCodes;
  }

  async changePassword(currentPassword: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/password/change', { currentPassword, password }));
  }

  async removePassword(currentPassword: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/password/remove', { currentPassword }));
  }

  async linkGoogle(grantId: string, idToken: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/google/link', { grantId, idToken }));
  }

  async getIdentityProviders(): Promise<IdentityProviders> {
    const response = await firstValueFrom(
      this.http.get<ResponseEnvelope<IdentityProviders>>('/api/auth/identity/providers'),
    );

    return response.data;
  }
}
