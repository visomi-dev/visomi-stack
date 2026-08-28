import { booleanAttribute, Component, computed, input, numberAttribute } from '@angular/core';

@Component({
  host: {
    '[style.--loader-animation-duration]': 'durationStyle()',
    class: /* tw */ 'block w-16',
  },
  selector: 'app-loader',
  templateUrl: './loader.html',
  styleUrl: './loader.css',
})
export class Loader {
  readonly active = input(true, { transform: booleanAttribute });
  readonly duration = input(1000, { transform: numberAttribute });

  readonly durationStyle = computed(() => `${this.duration()}ms`);
}
