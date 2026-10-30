import { Directive } from '@angular/core';

import { fieldset as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'fieldset[appUI]',
  host: { '[class]': 'classes' },
})
export class Fieldset {
  protected readonly classes = styles.classes();
}
