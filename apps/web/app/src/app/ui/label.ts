import { Directive, booleanAttribute, computed, input } from '@angular/core';

import { label as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'label[appUI]:not([appUI=radio-card]),legend[appUI]',
  host: { '[class]': 'classes()' },
})
export class Label {
  readonly inline = input<boolean>(false, { transform: booleanAttribute });

  protected readonly classes = computed(() => styles.classes({ inline: this.inline() }));
}
