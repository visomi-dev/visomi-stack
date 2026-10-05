import { afterNextRender, afterRenderEffect, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { Auth } from '../auth/auth';
import { VaultSession } from '../../vault/vault-session';
import { AccountProfile } from '../auth/account-profile';
import { Settings } from '../settings';
import { AppUpdates } from '../app-updates';
import { Button } from '../ui/actions/button/button';
import { DASHBOARD_URL } from '../constants/routes';
import {
  BottomNavigation,
  BottomNavigationItem,
  BottomNavigationAction,
} from '../ui/layout/bottom-navigation/bottom-navigation';
import { Icon } from '../ui/media/icon/icon';
import { type IconName } from '../ui/media/icon/icon-paths';

import { SidebarMenu } from './sidebar-menu/sidebar-menu';
import { PageTitles } from './page-titles';

type BottomNavItem = {
  ariaLabel: string;
  exact: boolean;
  icon: IconName;
  url: string;
};

const BOTTOM_NAV_ITEMS: ReadonlyArray<BottomNavItem> = Object.freeze([
  { ariaLabel: $localize`:@@layoutBottomNavOverview:Overview`, exact: true, icon: 'grid', url: DASHBOARD_URL },
]);

@Component({
  imports: [
    BottomNavigation,
    BottomNavigationItem,
    BottomNavigationAction,
    Icon,
    RouterLink,
    RouterOutlet,
    SidebarMenu,
    Button,
    NgTemplateOutlet,
  ],
  providers: [PageTitles],
  selector: 'app-layout',
  templateUrl: './layout.html',
  styleUrl: './layout.css',
})
export class Layout {
  protected readonly pageTitles = inject(PageTitles);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly appUpdates = inject(AppUpdates);
  private readonly auth = inject(Auth);
  private readonly vault = inject(VaultSession);
  private readonly router = inject(Router);
  private readonly settings = inject(Settings);
  private readonly accountProfile = inject(AccountProfile);

  readonly mobileMenuOpen = signal(false);
  readonly sidebarCollapsed = signal(false);

  private readonly navigationEnd = toSignal(
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)),
    {
      initialValue: null,
    },
  );

  readonly hideAppShell = computed(() => {
    this.navigationEnd();

    let route = this.router.routerState.snapshot.root;

    while (route.firstChild) {
      route = route.firstChild;
    }

    const routeData = route.data ?? {};
    const mergedData = { ...routeData };
    let parent = route.parent;

    while (parent) {
      Object.assign(mergedData, parent.data ?? {});
      parent = parent.parent;
    }

    return mergedData['hideAppShell'] === true;
  });
  readonly showAppShell = computed(() => this.auth.isAuthenticated() && !this.hideAppShell());

  readonly bottomNavItems = BOTTOM_NAV_ITEMS;

  private menuOpener: HTMLElement | null = null;

  openMobileMenu() {
    const active = this.document.activeElement;
    const HTMLElementConstructor = this.document.defaultView?.HTMLElement;

    this.menuOpener = HTMLElementConstructor && active instanceof HTMLElementConstructor ? active : null;
    this.mobileMenuOpen.set(true);
  }

  closeMobileMenu() {
    this.mobileMenuOpen.set(false);
  }

  toggleSidebarCollapsed() {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  readonly applyThemeEffect = afterRenderEffect({
    write: () => {
      this.settings.applyTheme();
      const userId = this.auth.isAuthenticated() ? (this.auth.user()?.id ?? null) : null;

      if (!userId || this.showAppShell())
        void this.accountProfile.synchronizePreferences(userId, () => this.router.url);
    },
  });

  private readonly initializeUpdates = afterNextRender(() => {
    this.destroyRef.onDestroy(this.appUpdates.start());
    this.destroyRef.onDestroy(this.vault.startLifecycle());
  });

  private readonly closeDrawerOnDesktop = afterNextRender(() => {
    const desktop = this.document.defaultView?.matchMedia?.('(min-width: 1024px)');

    if (!desktop) return;
    const closeOnDesktop = () => {
      if (desktop.matches) this.closeMobileMenu();
    };

    desktop.addEventListener('change', closeOnDesktop);
    this.destroyRef.onDestroy(() => desktop.removeEventListener('change', closeOnDesktop));
    closeOnDesktop();
  });

  private readonly restoreNavigationFocus = afterRenderEffect({
    write: () => {
      if (!this.mobileMenuOpen() && this.menuOpener) {
        if (this.menuOpener.isConnected) this.menuOpener.focus();
        this.menuOpener = null;
      }
    },
  });
}
