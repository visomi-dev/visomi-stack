import { Directive, booleanAttribute, computed, input } from '@angular/core';

import {
  text as styles,
  type TextSize,
  type TextTone,
  type TextWeight,
  type TextLeading,
} from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'p[appUI]:not([appUI=description]):not([appUI=error]),span[appUI=text]',
  host: { '[class]': 'classes()' },
})
export class Text {
  readonly uiSize = input<TextSize>('md');
  readonly tone = input<TextTone>('default');
  readonly weight = input<TextWeight>('inherit');
  readonly leading = input<TextLeading>('default');
  readonly mono = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() =>
    styles.classes({
      size: this.uiSize(),
      tone: this.tone(),
      weight: this.weight(),
      leading: this.leading(),
      mono: this.mono(),
    }),
  );
}
