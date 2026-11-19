import { ChangeDetectionStrategy, Component, LOCALE_ID, inject } from '@angular/core';

import { Link } from '../../ui';

import { browserPrivacyCopy } from '@visomi-stack/web-shared-observability';

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
