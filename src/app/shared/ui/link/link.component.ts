import { NgClass } from '@angular/common';
import { Component, Input, booleanAttribute } from '@angular/core';

@Component({
  selector: 'app-link',
  standalone: true,
  imports: [NgClass],
  template: `
    <a
      class="w-full rounded-lg text-primary underline hover:text-opacity-75 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-4 focus:ring-offset-white dark:focus:ring-offset-black"
      [attr.href]="href"
      [attr.target]="target"
      [ngClass]="{
        'opacity-50': disabled,
        'cursor-not-allowed': disabled,
        'pointer-events-none': disabled,
      }"
    >
      <ng-content />
    </a>
  `,
  styles: [],
})
export class LinkComponent {
  @Input() href?: string;
  @Input({ required: false, transform: booleanAttribute }) disabled?: boolean =
    false;
  @Input() target?: string;
}
