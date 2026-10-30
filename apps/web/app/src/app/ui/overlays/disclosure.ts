import { Directive } from '@angular/core';

import { disclosure as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'details[appUI]',
  host: { '[class]': 'classes' },
})
export class Disclosure {
  protected readonly classes = styles.classes();
}
