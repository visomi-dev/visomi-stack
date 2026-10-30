import { Directive } from '@angular/core';

import { pageHeader as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'header[appUI]',
  host: { '[class]': 'classes' },
})
export class PageHeader {
  protected readonly classes = styles.classes();
}
