import { Component, input } from '@angular/core';

import { APP_NAME } from '../../constants/brand';

type LogoVariant = 'isotype' | 'wordmark' | 'mark' | 'mark-name';

@Component({
  host: {
    class: /* tw */ 'contents',
  },

  selector: 'app-logo',
  templateUrl: './logo.html',
  styleUrl: './logo.css',
})
export class Logo {
  protected readonly appName = APP_NAME;
  readonly variant = input<LogoVariant>('isotype');
}
