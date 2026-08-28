import { Component, input } from '@angular/core';

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
  readonly variant = input<LogoVariant>('isotype');
}
