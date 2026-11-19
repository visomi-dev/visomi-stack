import { Component } from '@angular/core';

import { errorMessage as styles } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'p[app-error]',
  template: '<span><ng-content /></span>',
  host: { 'data-slot': 'error', 'aria-live': 'polite', 'aria-atomic': 'true', '[class]': 'classes' },
})
export class ErrorMessage {
  protected readonly classes = styles.classes();
}
