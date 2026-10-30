import { Directive, computed, input } from '@angular/core';

import { navItem, type NavigationPlacement } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'a[appUI=nav-item],button[appUI=nav-item]',
  host: { '[class]': 'classes()' },
})
export class NavItem {
  readonly placement = input<NavigationPlacement>('sidebar');

  protected readonly classes = computed(() => navItem.classes({ placement: this.placement() }));
}
