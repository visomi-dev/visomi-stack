import { Component, input } from '@angular/core';

@Component({
  host: {
    class: /* tw */ 'block',
  },
  selector: 'app-divider',
  templateUrl: './divider.html',
  styleUrl: './divider.css',
})
export class Divider {
  readonly label = input('');
}
