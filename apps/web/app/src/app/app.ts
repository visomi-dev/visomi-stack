import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Navigation } from './shared/navigation';
import { PageLoader } from './ui/layout/page-loader';
import { ThemeHost } from './ui/theme/theme-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, PageLoader],
  hostDirectives: [ThemeHost],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly navigation = inject(Navigation);
}
