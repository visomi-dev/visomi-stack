import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

import { Button, Link } from '../ui';

import { BROWSER_ERROR_REPORTER } from './browser-telemetry';

import { browserPrivacyCopy } from '@visomi-stack/web-shared-observability';

@Component({
  selector: 'app-consent-notice',
  imports: [Button, Link],
  template: `
    @if (visible()) {
      <section
        [attr.aria-label]="copy.title"
        class="mb-4 grid gap-2 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700"
      >
        <p>{{ copy.invitation }}</p>

        <div class="grid w-fit grid-cols-2 gap-2">
          <button appUI variant="secondary" size="sm" (click)="choose(false)">{{ copy.reject }}</button>

          <button appUI variant="secondary" size="sm" [disabled]="blocked()" (click)="choose(true)">
            {{ copy.accept }}
          </button>
        </div>

        <a appUI class="justify-self-start" [href]="privacyUrl">{{ copy.purpose }}</a>

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
    this.feedback.set(this.consent?.permit() ? this.copy.on : this.copy.off);
  }

  private readonly initialize = afterNextRender(() => {
    const consent = this.consent;

    if (consent) {
      const sync = () => {
        this.blocked.set(consent.blocked());

        if (consent.blocked()) {
          this.feedback.set(this.copy.blocked);
        }
      };

      this.visible.set(!consent.decided());
      this.destroyRef.onDestroy(consent.subscribe(sync));
      sync();
    }
  });
}

@Component({
  selector: 'app-privacy-link',
  imports: [Link],
  template: `<a appUI class="inline-flex min-h-11 items-center" [href]="url">{{ label }}</a>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyLink {
  private readonly locale = inject(LOCALE_ID).startsWith('es') ? 'es' : 'en';

  protected readonly label = browserPrivacyCopy[this.locale].privacy;
  protected readonly url = '/' + this.locale + '/privacy/';
}
