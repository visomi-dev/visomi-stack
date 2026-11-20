import { Service, signal } from '@angular/core';

type Phase = 'idle' | 'syncing' | 'synced' | 'retry';

@Service()
export class VaultSyncStatus {
  private readonly state = signal<Phase>('idle');

  private retryAction?: () => void;

  readonly phase = this.state.asReadonly();

  show(phase: Phase, retry?: () => void): void {
    this.retryAction = retry;
    this.state.set(phase);
  }

  retry(): void {
    this.retryAction?.();
  }
}
