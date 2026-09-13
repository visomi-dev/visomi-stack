import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { ResponseEnvelope } from './auth.models';

export type DeviceApprovalRecord = {
  requestId: string;
  userCode?: string;
  status?: 'pending' | 'approved' | 'consumed' | 'denied';
  expiresAt: string;
};

@Injectable({ providedIn: 'root' })
export class DeviceApproval {
  private readonly http = inject(HttpClient);

  async request(accountId: string): Promise<DeviceApprovalRecord> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<DeviceApprovalRecord>>('/api/auth/device-approval/request', { accountId }),
    );

    return response.data;
  }

  async poll(requestId: string): Promise<DeviceApprovalRecord> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<DeviceApprovalRecord>>('/api/auth/device-approval/status', { requestId }),
    );

    return response.data;
  }

  async approve(requestId: string): Promise<DeviceApprovalRecord> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<DeviceApprovalRecord>>('/api/auth/device-approval/approve', { requestId }),
    );

    return response.data;
  }

  async consume(
    requestId: string,
    userCode: string,
  ): Promise<DeviceApprovalRecord & { accountId: string; grant: 'enrollment' }> {
    const response = await firstValueFrom(
      this.http.post<ResponseEnvelope<DeviceApprovalRecord & { accountId: string; grant: 'enrollment' }>>(
        '/api/auth/device-approval/consume',
        { requestId, userCode },
      ),
    );

    return response.data;
  }
}
