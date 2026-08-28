import { Component, computed, input } from '@angular/core';

import { uiClass } from '../../classes';

@Component({
  host: {
    class: /* tw */ 'block',
  },
  selector: 'app-fieldset',
  templateUrl: './fieldset.html',
  styleUrl: './fieldset.css',
})
export class Fieldset {
  readonly legend = input('');
  readonly tone = input<'default' | 'panel'>('default');

  readonly classes = computed(() => uiClass('grid gap-4', this.tone() === 'panel' && 'ui-panel p-4 md:p-6'));
}
