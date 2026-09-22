import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { Layout } from './shared/layout/layout';
import { APP_NAME } from './shared/constants/brand';

@Component({
  host: {
    class: /* tw */ 'block min-h-full w-full',
  },
  imports: [Layout],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly title = inject(Title);

  constructor() {
    this.title.setTitle(APP_NAME);
  }
}
