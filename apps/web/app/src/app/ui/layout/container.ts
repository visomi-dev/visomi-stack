import { Directive, computed, input } from '@angular/core';

import { container as styles, type ContainerWidth, type ContainerGutter } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'div[appUI=container]',
  host: { '[class]': 'classes()' },
})
export class Container {
  readonly width = input<ContainerWidth>('lg');
  readonly gutter = input<ContainerGutter>('default');

  protected readonly classes = computed(() => styles.classes({ width: this.width(), gutter: this.gutter() }));
}
