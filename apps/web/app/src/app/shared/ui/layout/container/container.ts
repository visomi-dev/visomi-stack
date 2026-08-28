import { Component, computed, input } from '@angular/core';

import { uiClass } from '../../classes';

type ContainerSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const containerSizes = Object.freeze({
  sm: /* tw */ 'max-w-3xl',
  md: /* tw */ 'max-w-5xl',
  lg: /* tw */ 'max-w-6xl',
  xl: /* tw */ 'max-w-7xl',
  full: /* tw */ 'max-w-none',
});

@Component({
  host: { class: /* tw */ 'block w-full' },
  selector: 'app-container',
  templateUrl: './container.html',
  styleUrl: './container.css',
})
export class Container {
  readonly size = input<ContainerSize>('lg');

  readonly classes = computed(() => uiClass('mx-auto w-full px-4 md:px-8', containerSizes[this.size()]));
}
