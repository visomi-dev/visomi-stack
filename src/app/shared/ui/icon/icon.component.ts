import {
  Component,
  HostBinding,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';

import type { IconName } from './paths';
import { IconsService } from './icon.service';

@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      class="h-full w-full"
      fill="none"
      stroke-width="1.5"
      stroke="currentColor"
    >
      @for (path of paths(); track path) {
        <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="path" />
      }
    </svg>
  `,
  styles: [],
})
export class IconComponent {
  @HostBinding('class') readonly cls = /* tw */ 'block';

  @Input({
    required: true,
  })
  set icon(value: IconName) {
    this.$icon.set(value);
  }

  private readonly iconService = inject(IconsService);

  readonly $icon = signal<IconName>('arrow-right');

  readonly paths = computed(
    () => this.iconService.paths().get(this.$icon()) ?? [],
  );
}
