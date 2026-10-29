import { Directive } from '@angular/core';

import { description as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'p[appUI=description]',
  host: { '[class]': 'classes' },
})
export class Description {
  protected readonly classes = styles.classes();
}
