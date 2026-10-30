import { Directive } from '@angular/core';

import { radioCard as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'label[appUI=radio-card]',
  host: { 'data-slot': 'radio-card', '[class]': 'classes' },
})
export class RadioCard {
  protected readonly classes = styles.classes();
}
