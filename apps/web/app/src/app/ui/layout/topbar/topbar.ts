import { Component, booleanAttribute, computed, input } from '@angular/core';

import { topbar } from '@visomi-stack/web-frontend-ui';

@Component({
  selector: 'header[app-topbar]',
  template: `
    <div [class]="titleClasses"><ng-content select="[data-slot=title]" /></div>

    <div [class]="actionsClasses"><ng-content /></div>
  `,
  host: { '[class]': 'classes()' },
})
export class Topbar {
  readonly compact = input(false, { transform: booleanAttribute });
  protected readonly classes = computed(() => topbar.classes({ compact: this.compact() }));

  protected readonly titleClasses = topbar.titleClasses();
  protected readonly actionsClasses = topbar.actionsClasses();
}
