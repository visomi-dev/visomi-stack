import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type {
  ActivationMilestone,
  ActivationState,
  CreateApiKeyPayload,
  CreatedApiKey,
  ResponseEnvelope,
} from './activation.models';

@Injectable({
  providedIn: 'root',
})
export class Activation {
  private readonly http = inject(HttpClient);

  async loadState() {
    const response = await firstValueFrom(this.http.get<ResponseEnvelope<ActivationState>>('/api/activation'));

    return response.data;
  }

  async createApiKey(payload: CreateApiKeyPayload) {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<CreatedApiKey>>('/api/activation/api-keys', payload),
    );

    return response.data;
  }

  async recordMilestone(milestone: ActivationMilestone, metadata?: Record<string, string | null>) {
    await firstValueFrom(
      this.http.post('/api/activation/milestones', { metadata, milestone }, { responseType: 'text' }),
    );
  }

  async revokeApiKey(apiKeyId: string) {
    await firstValueFrom(this.http.post(`/api/activation/api-keys/${apiKeyId}/revoke`, {}, { responseType: 'text' }));
  }
}
