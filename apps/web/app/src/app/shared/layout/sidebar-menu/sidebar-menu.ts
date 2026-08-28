import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';

import { Auth } from '../../auth/auth';
import { APP_URL, SECURITY_URL, SIGN_IN_URL } from '../../constants/routes';
import { Settings } from '../../settings';
import { Avatar } from '../../ui/data/avatar/avatar';
import { Icon } from '../../ui/media/icon/icon';
import { type IconName } from '../../ui/media/icon/icon-paths';

type LayoutNavItem = {
  children?: LayoutNavItem[];
  exact: boolean;
  icon: IconName;
  label: string;
  url: string;
};

type LayoutNavSection = {
  label: string;
  items: LayoutNavItem[];
};

@Component({
  imports: [Avatar, Icon, RouterLink, RouterLinkActive],
  selector: 'app-sidebar-menu',
  templateUrl: './sidebar-menu.html',
  styleUrl: './sidebar-menu.css',
})
export class SidebarMenu {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly settings = inject(Settings);

  readonly collapsed = input(false);
  readonly APP_URL = APP_URL;
  readonly mobileMenuOpen = input(false);
  readonly closed = output<void>();
  readonly toggleCollapsed = output<void>();
  readonly signingOut = signal(false);
  readonly isDark = this.settings.isDark;
  readonly user = this.auth.user;

  readonly userInitials = computed(() => {
    const email = this.user()?.email ?? 'T';

    return email.slice(0, 2).toUpperCase();
  });

  readonly userEmail = computed(() => this.user()?.email ?? '');

  readonly navSections: LayoutNavSection[] = [
    {
      label: $localize`:@@layoutWorkspaceTitle:Workspace`,
      items: [
        {
          exact: true,
          icon: 'grid',
          label: $localize`:@@layoutMenuWorkspace:Workspace`,
          url: APP_URL,
        },
        { exact: true, icon: 'circle-info', label: $localize`:@@layoutMenuSecurity:Security`, url: SECURITY_URL },
      ],
    },
  ];

  closeMenu() {
    this.closed.emit();
  }

  toggleTheme() {
    this.settings.toggleTheme();
  }

  async signOut() {
    this.signingOut.set(true);

    try {
      await this.auth.signOut();
      await this.router.navigateByUrl(SIGN_IN_URL);
    } finally {
      this.signingOut.set(false);
      this.closeMenu();
    }
  }
}
