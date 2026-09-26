import { afterRenderEffect, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { Auth } from '../auth/auth';
import { AccountProfile } from '../auth/account-profile';
import { Settings } from '../settings';
import { DASHBOARD_URL } from '../constants/routes';
import {
  BottomNavigation,
  BottomNavigationItem,
  BottomNavigationAction,
} from '../ui/layout/bottom-navigation/bottom-navigation';
import { Icon } from '../ui/media/icon/icon';
import { type IconName } from '../ui/media/icon/icon-paths';

import { SidebarMenu } from './sidebar-menu/sidebar-menu';

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
  ],
  selector: 'app-layout',
  templateUrl: './layout.html',
  styleUrl: './layout.css',
})
export class Layout {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly settings = inject(Settings);
  private readonly accountProfile = inject(AccountProfile);

  private readonly navigationEnd = toSignal(
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)),
    {
      initialValue: null,
    },
  );

  readonly mobileMenuOpen = signal(false);
  readonly sidebarCollapsed = signal(false);

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

  readonly applyThemeEffect = afterRenderEffect({
    write: () => {
      this.settings.applyTheme();
      const userId = this.auth.isAuthenticated() ? (this.auth.user()?.id ?? null) : null;

      if (!userId || this.showAppShell())
        void this.accountProfile.synchronizePreferences(userId, () => this.router.url);
    },
  });

  readonly bottomNavItems = BOTTOM_NAV_ITEMS;

  openMobileMenu() {
    this.mobileMenuOpen.set(true);
  }

  closeMobileMenu() {
    this.mobileMenuOpen.set(false);
  }

  toggleSidebarCollapsed() {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }
}
