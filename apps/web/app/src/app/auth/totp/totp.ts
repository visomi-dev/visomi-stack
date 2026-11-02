import { Service, inject } from '@angular/core';

import { AuthHttp } from '../shared/http';
import type { SessionResult } from '../session/models';

export type TotpSetup = { enrollmentId: string; secret: string; uri: string };
export type BackupResult = SessionResult & { recoveryCodes: string[] };
@Service({ autoProvided: false })
export class Totp {
  private readonly http = inject(AuthHttp);

  setup(): Promise<TotpSetup> {
    return this.http.request('POST', '/totp/setup', {});
  }

  confirm(enrollmentId: string, code: string): Promise<BackupResult> {
    return this.http.request('POST', '/totp/confirm', { enrollmentId, code });
  }

  remove(): Promise<SessionResult> {
    return this.http.request('DELETE', '/totp');
  }

  regenerate(): Promise<BackupResult> {
    return this.http.request('POST', '/recovery-codes/regenerate', {});
  }
}
