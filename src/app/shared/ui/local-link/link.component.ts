import { Component, booleanAttribute, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-local-link',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './link.component.html',
})
export class LocalLinkComponent {
  readonly to = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
}
