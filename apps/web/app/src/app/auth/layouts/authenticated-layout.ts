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
  providers: [AuthHttp],
  template: ` <app-shell content-id="workspace-main" skip-label="Skip to content" i18n-skip-label="@@skip">
    <app-sidebar label="Primary navigation" i18n-label="@@shellPrimary"
      ><a data-slot="brand" routerLink="/home" class="rounded font-heading text-xl font-bold ui-focus-ring"
        >VISOMI<span class="text-blue-600">.</span></a
      >
      <div class="space-y-1">
        <a appUI="nav-item" routerLink="/home" routerLinkActive="active" ariaCurrentWhenActive="page" i18n="@@authHome"
          >Home</a
        ><a
          appUI="nav-item"
          routerLink="/account"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
          i18n="@@authAccount"
          >Account</a
        ><a
          appUI="nav-item"
          routerLink="/security"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
          i18n="@@authSecurity"
          >Security</a
        >
      </div>
      <div data-slot="footer">
        <button appUI [disabled]="action.busy()" (click)="logout()" i18n="@@authSignOut">Sign out</button>
      </div></app-sidebar
    >
    <header app-topbar>
      <a data-slot="title" routerLink="/home" class="rounded font-heading font-bold ui-focus-ring">VISOMI</a>
      <div data-slot="actions" class="flex flex-wrap items-center gap-4">
        <app-auth-language /><app-auth-appearance />
      </div>
    </header>
    <div class="space-y-6">
      <app-auth-feedback [action]="action" />
      @if (navigation.notificationFailed()) {
        <div appUI="alert" role="status" i18n="@@authNotificationFailed">
          The change was saved, but the notification could not be sent.
        </div>
      }
      @if (session.full()) {
        <router-outlet />
      } @else {
        <p role="status" i18n="@@authSessionUnavailable">
          Your session changed or could not be checked. Return to sign in to continue.
        </p>
        <a appUI routerLink="/auth/sign-in" i18n="@@authBackSignIn">Back to sign in</a>
      }
    </div>
    <nav appUI="navbar" aria-label="Primary navigation" i18n-aria-label="@@shellPrimary">
      <a
        appUI="nav-item"
        placement="navbar"
        routerLink="/home"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        i18n="@@authHome"
        >Home</a
      >
      <a
        appUI="nav-item"
        placement="navbar"
        routerLink="/account"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        i18n="@@authAccount"
        >Account</a
      >
      <a
        appUI="nav-item"
        placement="navbar"
        routerLink="/security"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        i18n="@@authSecurity"
        >Security</a
      >
      <button
        appUI="nav-item"
        placement="navbar"
        type="button"
        [disabled]="action.busy()"
        (click)="logout()"
        i18n="@@authSignOut"
      >
        Sign out
      </button>
    </nav>
  </app-shell>`,
})
export class AuthenticatedLayout {
  readonly session = inject(Session);
  readonly navigation = inject(AuthNavigation);
  private readonly http = inject(AuthHttp);
  private readonly router = inject(Router);

  readonly action = new Action();

  logout(): void {
    void this.action.run(async () => {
      try {
        this.session.cancelOperations();

        await this.http.request('POST', '/logout', {});

        this.session.clear();
        this.navigation.notificationFailed.set(false);
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
