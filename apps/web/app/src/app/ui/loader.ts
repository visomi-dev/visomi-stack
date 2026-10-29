import { Directive } from '@angular/core';

import { loader as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'span[appUI=loader]',
  host: { '[class]': 'classes' },
})
export class Loader {
  protected readonly classes = styles.classes();
}
