import { Service, inject } from '@angular/core';

import { AuthHttp } from '../shared/http';
import type { SessionView } from '../session/models';

export type DeviceRequest = { requestId: string; userCode: string; expiresAt: string };
export type DeviceStatus = {
  requestId: string;
  status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'consumed' | 'expired';
  expiresAt: string;
};

@Service({ autoProvided: false })
export class Devices {
  private readonly http = inject(AuthHttp);

  request(email: string): Promise<DeviceRequest> {
    return this.http.request('POST', '/device-approval/request', { email });
  }

  status(requestId: string, signal?: AbortSignal): Promise<DeviceStatus> {
    return this.http.request('POST', '/device-approval/status', { requestId }, signal);
  }

  review(requestId: string, signal?: AbortSignal): Promise<DeviceStatus> {
    return this.http.request('POST', '/device-approval/review', { requestId }, signal);
  }

  decide(requestId: string, userCode: string, approve: boolean, signal?: AbortSignal): Promise<void> {
    return this.http.request(
      'POST',
      approve ? '/device-approval/approve' : '/device-approval/deny',
      {
        requestId,
        userCode,
      },
      signal,
    );
  }

  cancel(requestId: string): Promise<void> {
    return this.http.request('POST', '/device-approval/cancel', { requestId });
  }

  consume(requestId: string, userCode: string): Promise<SessionView> {
    return this.http.request('POST', '/device-approval/consume', { requestId, userCode });
  }
}
