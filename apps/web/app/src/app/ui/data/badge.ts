import { Directive, computed, input } from '@angular/core';

import { badge as styles, type Tone } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'span[appUI=badge]',
  host: { '[class]': 'classes()' },
})
export class Badge {
  readonly tone = input<Tone>('neutral');

  protected readonly classes = computed(() => styles.classes({ tone: this.tone() }));
}
