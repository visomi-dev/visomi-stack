import type { Signal } from '@angular/core';

export type ApprovalEvent = 'connected' | 'disconnected' | 'changed';

export abstract class SessionRealtime {
  abstract readonly connected: Signal<boolean>;

  abstract connectSession(refresh: () => void): () => void;

  abstract checkSession(): Promise<boolean>;

  abstract watchDeviceApproval(requestId: string, notify: (event: ApprovalEvent) => void): () => void;
}
