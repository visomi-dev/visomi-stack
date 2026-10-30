import { Directive, computed, input } from '@angular/core';

import { alert as styles, type Tone } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'div[appUI=alert],section[appUI=alert]',
  host: { '[class]': 'classes()' },
})
export class Alert {
  readonly tone = input<Tone>('accent');

  protected readonly classes = computed(() => styles.classes({ tone: this.tone() }));
}
