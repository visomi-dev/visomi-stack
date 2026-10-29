import { Directive } from '@angular/core';

import { field as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'div[appUI=field]',
  host: { '[class]': 'classes' },
})
export class Field {
  protected readonly classes = styles.classes();
}
