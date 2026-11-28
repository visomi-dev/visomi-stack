import { DOCUMENT, DestroyRef, Service, afterNextRender, computed, inject, signal } from '@angular/core';

type Phase = 'idle' | 'syncing' | 'synced' | 'retry';

@Service()
export class VaultSyncStatus {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly state = signal<Phase>('idle');
  private readonly online = signal(true);
  private readonly pending = signal(false);
  private readonly lastSuccess = signal<number | null>(null);

  private retryAction?: () => void;

  readonly phase = this.state.asReadonly();
  readonly displayPhase = computed(() => {
    const phase = this.phase();

    if (!this.online()) {
      return this.pending() ? 'waiting' : phase === 'idle' ? 'idle' : 'offline';
    }

    if (this.pending() && (phase === 'idle' || phase === 'synced')) {
      return 'waiting';
    }

    return phase;
  });

  readonly lastSyncedAt = this.lastSuccess.asReadonly();

  show(phase: Phase, retry?: () => void): void {
    this.retryAction = retry;
    this.state.set(phase);

    if (phase === 'synced') {
      this.lastSuccess.set(Date.now());
    }
  }

  setPending(pending: boolean): void {
    this.pending.set(pending);
  }

  reset(): void {
    this.show('idle');
    this.pending.set(false);
    this.lastSuccess.set(null);
  }

  retry(): void {
    this.retryAction?.();
  }

  private readonly watchNetwork = afterNextRender(() => {
    const view = this.document.defaultView;

    if (!view) {
      return;
    }

    const update = () => this.online.set(view.navigator.onLine);

    update();
    view.addEventListener('online', update);
    view.addEventListener('offline', update);
    this.destroyRef.onDestroy(() => {
      view.removeEventListener('online', update);
      view.removeEventListener('offline', update);
    });
  });
}
