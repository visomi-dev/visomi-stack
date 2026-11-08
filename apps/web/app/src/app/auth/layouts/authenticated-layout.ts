import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { Alert, AppShell, Sidebar, Topbar, NavItem, Navbar, Button, Link } from '../../ui';
import { AuthHttp } from '../shared/http';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';
import { Session } from '../session/session';
import { AuthNavigation } from '../shared/navigation';

import { AuthLanguage } from './language';
import { Appearance } from './appearance';

@Component({
  selector: 'app-authenticated-layout',
  imports: [
    AppShell,
    Sidebar,
    Topbar,
    NavItem,
    Navbar,
    Button,
    Link,
    Alert,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    Appearance,
    AuthLanguage,
    AuthFeedback,
  ],
  providers: [Action, AuthHttp],
  templateUrl: './authenticated-layout.html',
})
export class AuthenticatedLayout {
  readonly session = inject(Session);
  readonly navigation = inject(AuthNavigation);
  private readonly http = inject(AuthHttp);
  private readonly router = inject(Router);
  readonly action = inject(Action);

  logout(): void {
    void this.action.run(async () => {
      try {
        this.session.cancelOperations();

        await this.http.request('POST', '/logout', {});

        this.session.clear();
        this.navigation.clearNotification();
      } catch (error) {
        await this.session.load(true);

        if (this.session.snapshot().access !== 'anonymous' || this.session.status() !== 'ready') {
          throw error;
        }
      }

      await this.router.navigate(['/auth/sign-in']);
    });
  }
}
