import { Directive } from '@angular/core';

import { toggle as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'input[appUI=switch][type=checkbox]',
  host: { '[class]': 'classes', role: 'switch' },
})
export class Toggle {
  protected readonly classes = styles.classes();
}
