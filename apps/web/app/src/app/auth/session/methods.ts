import { Service, inject } from '@angular/core';

import { AuthHttp } from '../shared/http';

export type MethodsView = {
  password: boolean;
  google: { id: string }[];
  passkeys: { id: string; label: string }[];
  totp: boolean;
};
export type SessionEntry = { id: string; current: boolean; createdAt: string; expiresAt: string; method?: string };

@Service({ autoProvided: false })
export class Methods {
  private readonly http = inject(AuthHttp);

  list(): Promise<MethodsView> {
    return this.http.request('GET', '/methods');
  }

  sessions(): Promise<{ sessions: SessionEntry[] }> {
    return this.http.request('GET', '/sessions');
  }

  revoke(id: string): Promise<void> {
    return this.http.request('DELETE', '/sessions/' + encodeURIComponent(id));
  }

  revokeOthers(): Promise<void> {
    return this.http.request('POST', '/sessions/revoke-others', {});
  }
}
