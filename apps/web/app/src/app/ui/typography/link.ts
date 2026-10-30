import { Directive } from '@angular/core';

import { link as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'a[appUI]:not([appUI=button]):not([appUI=nav-item])',
  host: { '[class]': 'classes' },
})
export class Link {
  protected readonly classes = styles.classes();
}
