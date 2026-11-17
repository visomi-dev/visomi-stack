import { Component, DestroyRef, computed, afterNextRender, inject, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { Alert, AppShell, Sidebar, Topbar, NavItem, Navbar, Button, Link, ThemeSwitcher, Dialog } from '../ui';
import { AuthHttp } from '../auth/shared/http';
import { Action } from '../auth/shared/action';
import { AuthFeedback } from '../auth/shared/feedback';
import { Session } from '../auth/session/session';
import { Logout } from '../auth/session/logout';
import { AuthNavigation } from '../auth/shared/navigation';
import { VaultUnlock } from '../shared/db/vault-unlock';
import { Vaults } from '../shared/db/vaults';
import { DatabaseHttp } from '../shared/db/http';
import { Navigation } from '../shared/navigation';
import { LanguageSwitcher } from '../i18n/language-switcher';

@Component({
  selector: 'app-authenticated-layout',
  imports: [
    VaultUnlock,
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
  providers: [Action, AuthHttp, Logout, Vaults, DatabaseHttp],
  templateUrl: './authenticated-layout.html',
  styleUrl: './authenticated-layout.css',
})
export class AuthenticatedLayout {
  private readonly signOut = inject(Logout);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly pageNavigation = inject(Navigation);

  private readonly mobileMenu = viewChild.required(Dialog);

  readonly vaults = inject(Vaults);
  readonly session = inject(Session);
  readonly navigation = inject(AuthNavigation);
  readonly action = inject(Action);

  // The example route owns its contextual prompt; shared vault code has no route exclusions.
  readonly vaultMethod = computed(() => {
    this.pageNavigation.context();

    return this.vaults.show() && !this.router.url.startsWith('/persistence')
      ? this.vaults.binding()?.method
      : undefined;
  });

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
