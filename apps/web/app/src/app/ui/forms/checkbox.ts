import { Directive } from '@angular/core';

import { checkbox as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'input[appUI][type=checkbox]:not([appUI=switch])',
  host: { 'data-slot': 'control', '[class]': 'classes' },
})
export class Checkbox {
  protected readonly classes = styles.classes();
}
