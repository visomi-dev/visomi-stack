import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { Alert, AppShell, Sidebar, Topbar, NavItem, Navbar, Button, Link, ThemeSwitcher } from '../ui';
import { AuthHttp } from '../auth/shared/http';
import { Action } from '../auth/shared/action';
import { AuthFeedback } from '../auth/shared/feedback';
import { Session } from '../auth/session/session';
import { Logout } from '../auth/session/logout';
import { AuthNavigation } from '../auth/shared/navigation';
import { LanguageSwitcher } from '../i18n/language-switcher';

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
    ThemeSwitcher,
    LanguageSwitcher,
    AuthFeedback,
  ],
  providers: [Action, AuthHttp, Logout],
  templateUrl: './authenticated-layout.html',
})
export class AuthenticatedLayout {
  readonly session = inject(Session);
  readonly navigation = inject(AuthNavigation);
  private readonly signOut = inject(Logout);
  readonly action = inject(Action);

  logout(): void {
    void this.signOut.run({
      clearFlowState: () => this.navigation.clearNotification(),
      checkSessionOnFailure: true,
    });
  }
}
