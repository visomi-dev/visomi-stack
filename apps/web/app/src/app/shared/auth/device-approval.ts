import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { ResponseEnvelope } from './auth.models';

export type ApprovalStatus = 'pending' | 'approved' | 'consumed' | 'denied' | 'cancelled' | 'expired';
export type DeviceApprovalRequest = { requestId: string; userCode: string; expiresAt: string };
export type DeviceApprovalRecord = { requestId: string; status: ApprovalStatus; expiresAt: string };
export type DeviceApprovalReview = DeviceApprovalRecord & { accountId: string; createdAt: string; requester: boolean };

@Injectable({ providedIn: 'root' })
export class DeviceApproval {
  private readonly http = inject(HttpClient);

  async request(accountId: string): Promise<DeviceApprovalRequest> {
    return this.post<DeviceApprovalRequest>('request', { accountId });
  }

  async poll(requestId: string): Promise<DeviceApprovalRecord> {
    return this.post<DeviceApprovalRecord>('status', { requestId });
  }

  async review(requestId: string): Promise<DeviceApprovalReview> {
    return this.post<DeviceApprovalReview>('review', { requestId });
  }

  async approve(requestId: string): Promise<{ requestId: string; status: 'approved' }> {
    return this.post('approve', { requestId });
  }

  async cancel(requestId: string): Promise<{ requestId: string; status: 'cancelled' }> {
    return this.post('cancel', { requestId });
  }

  async deny(requestId: string): Promise<{ requestId: string; status: 'denied' }> {
    return this.post('deny', { requestId });
  }

  async consume(
    requestId: string,
    userCode: string,
  ): Promise<{ requestId: string; accountId: string; userId: string; grant: 'enrollment' }> {
    return this.post('consume', { requestId, userCode });
  }

  private async post<T>(operation: string, body: Record<string, string>): Promise<T> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<T>>(`/api/auth/device-approval/${operation}`, body),
    );

    return response.data;
  }
}
