import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

import { Button, Dialog } from '../../ui';
import { BROWSER_ERROR_REPORTER } from '../browser-telemetry';

import { browserPrivacyCopy, type BrowserErrorReport } from '@visomi-stack/web-shared-observability';

@Component({
  selector: 'app-browser-privacy',
  imports: [Button, Dialog],
  templateUrl: './browser-privacy.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrowserPrivacy {
  private readonly reporter = inject(BROWSER_ERROR_REPORTER, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  protected readonly automatic = signal(false);
  protected readonly pending = signal<BrowserErrorReport[]>([]);
  protected readonly sending = signal(false);
  protected readonly feedback = signal('');

  protected readonly copy = browserPrivacyCopy[inject(LOCALE_ID).startsWith('es') ? 'es' : 'en'];

  protected description(report: BrowserErrorReport): string {
    return report.code === 'unhandled_rejection'
      ? this.copy.rejection
      : report.code === 'startup_failed'
        ? this.copy.startup
        : this.copy.exception;
  }

  protected async send(report: BrowserErrorReport, close: HTMLElement): Promise<void> {
    if (this.sending() || !this.reporter) {
      return;
    }

    this.sending.set(true);
    close.focus();

    const sent = await this.reporter.sendPending(report);

    this.feedback.set(sent ? this.copy.sent : this.copy.failed);
    this.sending.set(false);
  }

  protected discard(report: BrowserErrorReport, close: HTMLElement): void {
    close.focus();
    this.feedback.set('');
    this.reporter?.discard(report);
  }

  private readonly initialize = afterNextRender(() => {
    const reporter = this.reporter;

    if (!reporter) {
      return;
    }

    const sync = () => {
      this.automatic.set(!!reporter.consent.permit());
      this.pending.set(reporter.pending());
    };

    this.destroyRef.onDestroy(reporter.subscribePending(sync));
    sync();
  });
}
