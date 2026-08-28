import { Component } from '@angular/core';

@Component({
  host: {
    class: /* tw */ 'ui-touch-target inline-flex items-center justify-center',
  },
  selector: 'app-touch-target',
  templateUrl: './touch-target.html',
  styleUrl: './touch-target.css',
})
export class TouchTarget {}
