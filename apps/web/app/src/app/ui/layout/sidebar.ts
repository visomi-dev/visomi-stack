import { Component, input } from '@angular/core';

import { sidebar } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'app-sidebar',
  template: `
    <ng-content select="[data-slot=brand]" />
    <nav [attr.aria-label]="label()" [class]="navigationClasses"><ng-content /></nav>
    <ng-content select="[data-slot=footer]" />
  `,
  host: { '[class]': 'classes' },
})
export class Sidebar {
  readonly label = input.required<string>();

  protected readonly classes = sidebar.classes();
  protected readonly navigationClasses = sidebar.navigationClasses();
}
