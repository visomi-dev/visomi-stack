import { Directive, computed, input } from '@angular/core';

import { avatar as styles, type AvatarSize } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'img[appUI],span[appUI=avatar]',
  host: { '[class]': 'classes()' },
})
export class Avatar {
  readonly uiSize = input<AvatarSize>('md');
  readonly shape = input<'circle' | 'rounded'>('circle');

  protected readonly classes = computed(() => styles.classes({ size: this.uiSize(), shape: this.shape() }));
}
