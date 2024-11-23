import { NgClass } from '@angular/common';
import { Component, Input, booleanAttribute } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-local-link',
  standalone: true,
  imports: [RouterLink, NgClass],
  template: `
    <a
      [routerLink]="to"
      class="w-full rounded-lg text-primary underline hover:text-opacity-75 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-4 focus:ring-offset-white dark:text-white dark:focus:ring-offset-black"
      [ngClass]="{
        'pointer-events-none cursor-not-allowed opacity-50': disabled,
      }"
    >
      <ng-content />
    </a>
  `,
  styles: [],
})
export class LocalLinkComponent {
  @Input() to?: string;
  @Input({ required: false, transform: booleanAttribute }) disabled?: boolean =
    false;
}
