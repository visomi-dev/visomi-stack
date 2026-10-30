import { Component } from '@angular/core';

import { topbar } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'header[app-topbar]',
  template: `
    <div [class]="titleClasses"><ng-content select="[data-slot=title]" /></div>
    <div [class]="actionsClasses"><ng-content /></div>
  `,
  host: { '[class]': 'classes' },
})
export class Topbar {
  protected readonly classes = topbar.classes();
  protected readonly titleClasses = topbar.titleClasses();
  protected readonly actionsClasses = topbar.actionsClasses();
}
