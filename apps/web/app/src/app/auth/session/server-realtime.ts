import { Service, signal } from '@angular/core';

import type { SessionRealtime } from './realtime';

@Service({ autoProvided: false })
export class ServerRealtime implements SessionRealtime {
  readonly connected = signal(false).asReadonly();

  connectSession(): () => void {
    return () => undefined;
  }

  checkSession(): Promise<boolean> {
    return Promise.resolve(false);
  }

  watchDeviceApproval(): () => void {
    return () => undefined;
  }
}
