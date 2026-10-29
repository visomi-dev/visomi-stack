import { Directive } from '@angular/core';

import { errorMessage as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'p[appUI=error]',
  host: { '[class]': 'classes' },
})
export class ErrorMessage {
  protected readonly classes = styles.classes();
}
