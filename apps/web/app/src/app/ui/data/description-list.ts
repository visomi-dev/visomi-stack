import { Directive } from '@angular/core';

import { descriptionList as styles } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'dl[appUI]',
  host: { '[class]': 'classes' },
})
export class DescriptionList {
  protected readonly classes = styles.classes();
}
