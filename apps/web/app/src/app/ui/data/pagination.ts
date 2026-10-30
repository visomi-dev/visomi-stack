import { Directive } from '@angular/core';

import { pagination as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'nav[appUI=pagination]',
  host: { '[class]': 'classes' },
})
export class Pagination {
  protected readonly classes = styles.classes();
}
