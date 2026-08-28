import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { Auth } from '../auth/auth';
import { Settings } from '../settings';
import { DASHBOARD_URL } from '../constants/routes';
import { BottomNavigation, BottomNavigationItem } from '../ui/layout/bottom-navigation/bottom-navigation';
import { Icon } from '../ui/media/icon/icon';
import { type IconName } from '../ui/media/icon/icon-paths';

import { SidebarMenu } from './sidebar-menu/sidebar-menu';
import { Topbar } from './topbar/topbar';

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
  imports: [BottomNavigation, BottomNavigationItem, Icon, RouterLink, RouterOutlet, SidebarMenu, Topbar],
  selector: 'app-layout',
  templateUrl: './layout.html',
  styleUrl: './layout.css',
})
export class Layout {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly settings = inject(Settings);

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

  readonly applyThemeEffect = effect(() => {
    this.settings.applyTheme();
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
