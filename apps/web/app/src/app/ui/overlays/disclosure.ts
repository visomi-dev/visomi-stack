import { Directive, computed, input } from '@angular/core';

import { disclosure as styles, type DisclosureAppearance } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'details[appUI]',
  host: { '[class]': 'classes()' },
})
export class Disclosure {
  readonly appearance = input<DisclosureAppearance>('default');

  protected readonly classes = computed(() => styles.classes({ appearance: this.appearance() }));
}
