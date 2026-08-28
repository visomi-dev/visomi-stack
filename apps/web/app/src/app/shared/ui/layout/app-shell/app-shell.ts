import { booleanAttribute, Component, input, output } from '@angular/core';

@Component({
  host: { class: /* tw */ 'block min-h-full bg-white dark:bg-slate-950 text-slate-950 dark:text-slate-50' },
  selector: 'app-app-shell',
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.css',
})
export class AppShell {
  readonly mobileMenuOpen = input(false, { transform: booleanAttribute });
  readonly mobileMenuClose = output<void>();
}
