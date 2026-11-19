import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

import { Button, Card, Link } from '../../ui';
import { BROWSER_ERROR_REPORTER } from '../browser-telemetry';

import { browserPrivacyCopy } from '@visomi-stack/web-shared-observability';

@Component({
  selector: 'app-consent-notice',
  imports: [Button, Card, Link],
  template: `
    @if (visible()) {
      <section
        appUI="card"
        tone="raised"
        padding="sm"
        layout="plain"
        [attr.aria-label]="copy.title"
        class="ui-consent-card grid gap-2 text-sm"
      >
        <p>{{ copy.invitation }}</p>

        <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-2">
          <button appUI variant="secondary" size="sm" type="button" (click)="choose(false)">{{ copy.reject }}</button>

          <button appUI variant="secondary" size="sm" type="button" [disabled]="blocked()" (click)="choose(true)">
            {{ copy.accept }}
          </button>
        </div>

        <a appUI class="justify-self-start" [href]="privacyUrl">{{ copy.purposeLink }}</a>

        <p role="status" class="empty:hidden">{{ feedback() }}</p>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsentNotice {
  private readonly consent = inject(BROWSER_ERROR_REPORTER, { optional: true })?.consent;
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID).startsWith('es') ? 'es' : 'en';

  protected readonly visible = signal(false);
  protected readonly blocked = signal(false);
  protected readonly feedback = signal('');

  protected readonly copy = browserPrivacyCopy[this.locale];
  protected readonly privacyUrl = '/' + this.locale + '/privacy/';

  protected choose(accepted: boolean): void {
    this.consent?.decide(accepted);
  }

  private readonly initialize = afterNextRender(() => {
    const consent = this.consent;

    if (consent) {
      const sync = () => {
        const blocked = consent.blocked();

        this.blocked.set(blocked);
        this.feedback.set(
          blocked ? this.copy.blocked : consent.permit() ? this.copy.on : consent.decided() ? this.copy.off : '',
        );
      };

      this.visible.set(!consent.decided());
      this.destroyRef.onDestroy(consent.subscribe(sync));
      sync();
    }
  });
}
