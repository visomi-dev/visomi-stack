import { Service, inject } from '@angular/core';

import { AuthHttp } from '../shared/http';
import type { Factor, FactorPending, Pending, SessionResult, SessionView } from '../session/models';

@Service({ autoProvided: false })
export class Passwords {
  private readonly http = inject(AuthHttp);

  signup(email: string, password: string): Promise<SessionView & Pending> {
    return this.http.request('POST', '/password/sign-up', { email, password });
  }

  signin(email: string, password: string): Promise<FactorPending> {
    return this.http.request('POST', '/password/sign-in', { email, password });
  }

  verify(flowId: string, factor: Factor): Promise<SessionView> {
    return this.http.request('POST', '/password/verify', { flowId, factor });
  }

  reset(email: string): Promise<Pending> {
    return this.http.request('POST', '/password/reset/request', { email });
  }

  completeReset(
    flowId: string,
    code: string,
    password: string,
    factor?: Factor,
  ): Promise<{ passwordReset: true; notificationSent: boolean }> {
    return this.http.request('POST', '/password/reset/complete', {
      flowId,
      code,
      password,
      ...(factor ? { factor } : {}),
    });
  }

  startReauth(password: string): Promise<FactorPending> {
    return this.http.request('POST', '/reauth/password/start', { password });
  }

  completeReauth(flowId: string, factor: Factor): Promise<SessionView> {
    return this.http.request('POST', '/reauth/password/complete', { flowId, factor });
  }

  save(password: string, exists: boolean): Promise<SessionResult> {
    return this.http.request('POST', exists ? '/password/change' : '/password/add', { password });
  }

  remove(): Promise<SessionResult | null> {
    return this.http.request('POST', '/password/remove', {});
  }
}
