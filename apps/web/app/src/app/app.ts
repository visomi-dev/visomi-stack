import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { email, form, FormField, required } from '@angular/forms/signals';

import { Button, Field, Input, Table, AppShell, Sidebar, Topbar, Navbar, NavItem } from './ui';

@Component({
  imports: [Button, Field, Input, Table, AppShell, Sidebar, Topbar, Navbar, NavItem, FormField],
  selector: 'app-root',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly count = signal(0);
  readonly emailModel = signal({ email: '' });
  readonly attempted = signal(false);
  readonly manualInvalid = signal(false);

  readonly emailForm = form(this.emailModel, (path) => {
    required(path.email);
    email(path.email);
  });

  readonly emailError = $localize`:@@fieldError:Enter a valid email address.`;
  readonly manualEmailError = $localize`:@@fieldManualError:This example address is unavailable.`;

  checkField(event: Event): void {
    event.preventDefault();
    this.attempted.set(true);
  }

  resetField(): void {
    this.emailForm().reset({ email: '' });
    this.attempted.set(false);
    this.manualInvalid.set(false);
  }

  increment() {
    this.count.update((value) => value + 1);
  }

  reset() {
    this.count.set(0);
  }
}
