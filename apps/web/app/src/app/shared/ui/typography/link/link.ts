import { booleanAttribute, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { uiClass } from '../../classes';

@Component({
  host: {
    class: /* tw */ 'inline',
  },
  imports: [RouterLink],
  selector: 'app-link',
  templateUrl: './link.html',
  styleUrl: './link.css',
})
export class Link {
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly href = input<string | null>(null);
  readonly routerLink = input<unknown[] | string | null>(null);
  readonly text = input.required<string>();

  readonly classes = computed(() =>
    uiClass(
      'ui-focus-ring rounded-sm text-accent underline underline-offset-4 transition hover:brightness-90',
      this.disabled() && 'pointer-events-none cursor-not-allowed opacity-50',
    ),
  );
}
