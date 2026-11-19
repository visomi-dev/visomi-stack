import { ChangeDetectionStrategy, Component, LOCALE_ID, booleanAttribute, inject, input } from '@angular/core';

import { Link, NavItem } from '../../ui';

import { browserPrivacyCopy } from '@visomi-stack/web-shared-observability';

@Component({
  selector: 'app-privacy-link',
  imports: [Link, NavItem],
  template: `
    @if (placement() === 'sidebar') {
      <a appUI="nav-item" [href]="url" [compact]="compact()" [attr.title]="compact() ? label : null">
        <svg
          data-slot="icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Zm-4 9 3 3 5-6" />
        </svg>

        <span data-slot="label">{{ label }}</span>
      </a>
    } @else {
      <a appUI class="inline-flex min-h-11 items-center" [href]="url">{{ label }}</a>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyLink {
  private readonly locale = inject(LOCALE_ID).startsWith('es') ? 'es' : 'en';

  protected readonly label = browserPrivacyCopy[this.locale].privacy;
  protected readonly url = '/' + this.locale + '/privacy/';

  readonly placement = input<'inline' | 'sidebar'>('inline');
  readonly compact = input(false, { transform: booleanAttribute });
}
