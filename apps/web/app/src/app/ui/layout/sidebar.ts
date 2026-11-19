import { Component, booleanAttribute, computed, input } from '@angular/core';

import { sidebar } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'app-sidebar',
  template: `
    <ng-content select="[data-slot=brand]" />
    <nav [attr.id]="navigationId()" [attr.aria-label]="label()" [class]="navigationClasses"><ng-content /></nav>
    <ng-content select="[data-slot=footer]" />
  `,
  host: { '[class]': 'classes()' },
})
export class Sidebar {
  readonly inset = input(false, { transform: booleanAttribute });
  protected readonly classes = computed(() => sidebar.classes({ inset: this.inset() }));

  protected readonly navigationClasses = sidebar.navigationClasses();

  readonly label = input.required<string>();
  readonly navigationId = input<string>('', { alias: 'navigation-id' });
}
