import { Directive, computed, input } from '@angular/core';

import { text as styles, type TextSize, type TextTone } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'p[appUI]:not([appUI=description]):not([appUI=error]),span[appUI=text]',
  host: { '[class]': 'classes()' },
})
export class Text {
  readonly uiSize = input<TextSize>('md');
  readonly tone = input<TextTone>('default');

  protected readonly classes = computed(() => styles.classes({ size: this.uiSize(), tone: this.tone() }));
}
