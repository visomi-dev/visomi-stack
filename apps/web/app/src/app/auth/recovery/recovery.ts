import { Service, inject } from '@angular/core';

import { AuthHttp } from '../shared/http';
import type { Pending, Factor, FactorPending, SessionResult } from '../session/models';

@Service({ autoProvided: false })
export class Recovery {
  private readonly http = inject(AuthHttp);

  request(email: string): Promise<Pending> {
    return this.http.request('POST', '/recovery/request', { email });
  }

  verify(flowId: string, code: string, factor?: Factor): Promise<SessionResult> {
    return this.http.request('POST', '/recovery/verify', { flowId, code, ...(factor ? { factor } : {}) });
  }

  password(password: string): Promise<FactorPending> {
    return this.http.request('POST', '/recovery/password', { password });
  }

  completePassword(flowId: string, password: string, factor: Factor): Promise<SessionResult> {
    return this.http.request('POST', '/recovery/password/complete', { flowId, password, factor });
  }
}
