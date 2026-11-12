import { Component, DestroyRef, afterNextRender, inject, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { Alert, AppShell, Sidebar, Topbar, NavItem, Navbar, Button, Link, ThemeSwitcher, Dialog } from '../ui';
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
    Dialog,
  ],
  providers: [Action, AuthHttp, Logout],
  templateUrl: './authenticated-layout.html',
  styleUrl: './authenticated-layout.css',
})
export class AuthenticatedLayout {
  readonly session = inject(Session);
  readonly navigation = inject(AuthNavigation);
  private readonly signOut = inject(Logout);
  readonly action = inject(Action);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly mobileMenu = viewChild.required(Dialog);

  logout(): void {
    void this.signOut.run({
      clearFlowState: () => this.navigation.clearNotification(),
      checkSessionOnFailure: true,
    });
  }

  private readonly closeDesktopMenu = afterNextRender(() => {
    const media = this.document.defaultView?.matchMedia?.('(min-width: 1024px)');

    if (!media) {
      return;
    }

    const close = () => {
      if (media.matches) {
        this.mobileMenu().close();
      }
    };

    media.addEventListener('change', close);
    this.destroyRef.onDestroy(() => media.removeEventListener('change', close));
  });
}
