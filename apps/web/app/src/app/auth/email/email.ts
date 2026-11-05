import { Service, inject } from '@angular/core';

import { AuthHttp } from '../shared/http';
import type { Pending, SessionView, SessionResult } from '../session/models';

@Service({ autoProvided: false })
export class Email {
  private readonly http = inject(AuthHttp);

  request(email?: string): Promise<Pending> {
    return this.http.request('POST', '/email/request', email ? { email } : {});
  }

  verify(flowId: string, code: string): Promise<SessionView> {
    return this.http.request('POST', '/email/verify', { flowId, code });
  }

  resend(flowId: string): Promise<Pending> {
    return this.http.request('POST', '/challenges/resend', { flowId });
  }

  change(email: string): Promise<Pending> {
    return this.http.request('POST', '/email/change/request', { email });
  }

  completeChange(flowId: string, code: string): Promise<SessionResult> {
    return this.http.request('POST', '/email/change/verify', { flowId, code });
  }
}
