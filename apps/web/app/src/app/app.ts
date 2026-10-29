import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { Button } from './ui/button';

@Component({
  imports: [Button],
  selector: 'app-root',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly count = signal(0);

  increment() {
    this.count.update((value) => value + 1);
  }

  reset() {
    this.count.set(0);
  }
}
