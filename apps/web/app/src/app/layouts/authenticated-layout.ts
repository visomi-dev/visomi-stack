import { Component, DestroyRef, ElementRef, computed, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import {
  Alert,
  AppShell,
  Sidebar,
  Topbar,
  NavItem,
  Navbar,
  Button,
  Link,
  ThemeSwitcher,
  Dialog,
  Avatar,
  Card,
  Disclosure,
} from '../ui';
import { AuthHttp } from '../auth/shared/http';
import { Action } from '../auth/shared/action';
import { AuthFeedback } from '../auth/shared/feedback';
import { Session } from '../auth/session/session';
import { Logout } from '../auth/session/logout';
import { AuthNavigation } from '../auth/shared/navigation';
import { VaultUnlock } from '../shared/vault/vault-unlock';
import { Vaults } from '../shared/vault/vaults';
import { DatabaseHttp } from '../shared/db/http';
import { Navigation } from '../shared/navigation';
import { LanguageSwitcher } from '../i18n/language-switcher';
import { BrowserPrivacy } from '../observability/browser-privacy';
import { ConsentNotice, PrivacyLink } from '../observability/consent-notice';

@Component({
  selector: 'app-authenticated-layout',
  imports: [
    BrowserPrivacy,
    ConsentNotice,
    PrivacyLink,
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
    Avatar,
    Card,
    Disclosure,
    NgTemplateOutlet,
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

  private readonly desktopAccount = viewChild.required<ElementRef<HTMLElement>>('desktopAccount');

  protected readonly sidebarCompact = signal(false);
  protected readonly accountOpen = signal(false);

  readonly session = inject(Session);

  protected readonly accountGlyph = computed(() => this.session.user()?.email?.charAt(0).toUpperCase() ?? '');
  protected readonly accountRouteActive = computed(() => {
    const path = this.router.lastSuccessfulNavigation()?.finalUrl?.root.children['primary']?.segments[0]?.path;

    return path === 'account' || path === 'security';
  });

  protected readonly signOutLabel = $localize`:@@authSignOut:Sign out`;
  protected readonly expandSidebar = $localize`:@@shellExpandSidebar:Expand sidebar`;
  protected readonly collapseSidebar = $localize`:@@shellCollapseSidebar:Collapse sidebar`;
  protected readonly primaryItems = [
    { path: '/home', label: $localize`:@@authHome:Home`, icon: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z' },
    {
      path: '/vault-example',
      label: $localize`:@@vaultDemoTitle:Vault example`,
      icon: 'M4 5h16v14H4zM8 5v14m8-7h.01M12 12h.01',
    },
  ];
  protected readonly securityItems = [
    { path: '/security/passkeys', label: $localize`:@@authPasskeys:Passkeys` },
    { path: '/security/password', label: $localize`:@@authPassword:Password` },
    { path: '/security/sessions', label: $localize`:@@authSessions:Sessions` },
  ];
  protected readonly accountMenu = $localize`:@@shellAccountMenu:Account menu`;

  readonly vaults = inject(Vaults);
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

  protected accountToggle(event: ToggleEvent): void {
    this.accountOpen.set(event.newState === 'open');
  }

  protected closeAccount(desktop: boolean): void {
    if (desktop) {
      this.desktopAccount().nativeElement.hidePopover?.();
    } else {
      this.mobileMenu().close();
    }
  }

  protected toggleSidebar(): void {
    this.sidebarCompact.update((compact) => !compact);
  }

  private readonly closeDesktopMenu = afterNextRender(() => {
    const media = this.document.defaultView?.matchMedia?.('(min-width: 1024px)');

    if (!media) {
      return;
    }

    const close = () => {
      if (media.matches) {
        this.mobileMenu().close();
      } else {
        this.desktopAccount().nativeElement.hidePopover?.();
      }
    };

    media.addEventListener('change', close);
    this.destroyRef.onDestroy(() => media.removeEventListener('change', close));
  });
}
