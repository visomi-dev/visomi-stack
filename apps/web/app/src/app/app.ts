import { Component } from '@angular/core';

import { Layout } from './shared/layout/layout';

@Component({
  host: {
    class: /* tw */ 'block min-h-full w-full',
  },
  imports: [Layout],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
