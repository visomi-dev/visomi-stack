import { Component, HostBinding, computed, inject, input } from '@angular/core';

import type { IconName } from './paths';
import { IconsService } from './icon.service';

@Component({
  selector: 'app-icon',
  standalone: true,
  templateUrl: './icon.component.html',
})
export class IconComponent {
  @HostBinding('class') readonly cls = /* tw */ 'block';

  private readonly iconService = inject(IconsService);

  readonly icon = input.required<IconName>();

  readonly paths = computed(
    () => this.iconService.paths().get(this.icon()) ?? [],
  );
}
