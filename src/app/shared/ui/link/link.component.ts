import { Component, booleanAttribute, input } from '@angular/core';

@Component({
  selector: 'app-link',
  standalone: true,
  templateUrl: './link.component.html',
})
export class LinkComponent {
  readonly href = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly target = input<string>();
}
