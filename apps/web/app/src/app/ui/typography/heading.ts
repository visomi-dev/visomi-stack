import { Directive, computed, input } from '@angular/core';

import { heading as styles, type HeadingSize } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'h1[appUI],h2[appUI],h3[appUI],h4[appUI],h5[appUI],h6[appUI]',
  host: { '[class]': 'classes()' },
})
export class Heading {
  readonly uiSize = input<HeadingSize>('lg');

  protected readonly classes = computed(() => styles.classes({ size: this.uiSize() }));
}
