import { Directive, booleanAttribute, computed, input } from '@angular/core';

import { table as styles, type TableDensity } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'table[appUI]',
  host: { '[class]': 'classes()' },
})
export class Table {
  readonly density = input<TableDensity>('comfortable');
  readonly striped = input<boolean>(false, { transform: booleanAttribute });
  readonly mobileCards = input(false, { transform: booleanAttribute });
  readonly stickyHeaders = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() =>
    styles.classes({
      density: this.density(),
      striped: this.striped(),
      mobileCards: this.mobileCards(),
      stickyHeaders: this.stickyHeaders(),
    }),
  );
}
