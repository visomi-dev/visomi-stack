import { Component, computed, input } from '@angular/core';

import { iconPaths, type IconName } from './icon-paths';

@Component({
  host: {
    class: /* tw */ 'block size-5',
  },
  selector: 'app-icon',
  templateUrl: './icon.html',
  styleUrl: './icon.css',
})
export class Icon {
  readonly ariaLabel = input<string | null>(null);
  readonly name = input.required<IconName>();

  readonly paths = computed(() => iconPaths[this.name()]);
}
