import { Directive, computed, input } from '@angular/core';

import { card as styles, type Padding, type SurfaceTone, type CardLayout } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'article[appUI],section[appUI=card],div[appUI=card]',
  host: { '[class]': 'classes()' },
})
export class Card {
  readonly tone = input<SurfaceTone>('default');
  readonly padding = input<Padding>('md');
  readonly layout = input<CardLayout>('stack');

  protected readonly classes = computed(() =>
    styles.classes({ tone: this.tone(), padding: this.padding(), layout: this.layout() }),
  );
}
