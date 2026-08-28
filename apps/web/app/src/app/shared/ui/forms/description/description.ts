import { Component, input } from '@angular/core';

@Component({
  host: {
    class: /* tw */ 'block',
  },
  selector: 'app-description',
  templateUrl: './description.html',
  styleUrl: './description.css',
})
export class Description {
  readonly id = input<string | null>(null);
}
