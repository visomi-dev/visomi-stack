import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { ResponseEnvelope } from './auth.models';

export type ActiveSession = {
  id: string;
  current: boolean;
  startedAt: string;
  lastActiveAt: string;
  expiresAt: string;
  method: 'password' | 'passkey' | 'google' | 'unknown';
};

@Service()
export class Sessions {
  private readonly http = inject(HttpClient);

  async list(): Promise<ActiveSession[]> {
    return (await firstValueFrom(this.http.get<ResponseEnvelope<ActiveSession[]>>('/api/auth/sessions'))).data;
  }

  async revoke(grantId: string, id?: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`/api/auth/sessions/${id ? 'revoke' : 'revoke-others'}`, id ? { grantId, id } : { grantId }),
    );
  }
}
