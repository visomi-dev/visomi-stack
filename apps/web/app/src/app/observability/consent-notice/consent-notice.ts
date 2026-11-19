import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

import { Button, Card, Link } from '../../ui';
import { BROWSER_ERROR_REPORTER } from '../browser-telemetry';

import {
  browserPrivacyCopy,
  connectConsentNotice,
  consentConfirmationSeconds,
  type ConsentNoticeView,
} from '@visomi-stack/web-shared-observability';

@Component({
  selector: 'app-consent-notice',
  imports: [Button, Card, Link],
  templateUrl: './consent-notice.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsentNotice {
  private readonly consent = inject(BROWSER_ERROR_REPORTER, { optional: true })?.consent;
  private readonly browser = inject(DOCUMENT).defaultView;
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly locale = inject(LOCALE_ID).startsWith('es') ? 'es' : 'en';

  private notice: ReturnType<typeof connectConsentNotice> | undefined;

  protected readonly view = signal<ConsentNoticeView>({ kind: 'hidden' });

  protected readonly duration = consentConfirmationSeconds;
  protected readonly copy = browserPrivacyCopy[this.locale];
  protected readonly privacyUrl = '/' + this.locale + '/privacy/';

  protected choose(accepted: boolean): void {
    this.notice?.choose(accepted);
  }

  private readonly initialize = afterNextRender(() => {
    if (this.consent && this.browser) {
      const notice = connectConsentNotice(this.browser, this.consent, (view) => this.view.set(view));

      this.notice = notice;
      this.destroyRef.onDestroy(notice.destroy);
      this.router.events
        .pipe(
          filter((event) => event instanceof NavigationStart),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(notice.dismiss);
    }
  });
}
