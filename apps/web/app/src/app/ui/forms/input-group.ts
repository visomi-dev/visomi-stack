import { Directive } from '@angular/core';

import { inputGroup as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'div[appUI=input-group]',
  host: { '[class]': 'classes' },
})
export class InputGroup {
  protected readonly classes = styles.classes();
}
