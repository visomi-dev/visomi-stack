import { Directive } from '@angular/core';

import { radio as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'input[appUI][type=radio]',
  host: { 'data-slot': 'control', '[class]': 'classes' },
})
export class Radio {
  protected readonly classes = styles.classes();
}
