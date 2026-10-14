import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LanguageSwitcher } from '../../../layout/language-switcher/language-switcher';
import { ThemeSwitcher } from '../../../layout/theme-switcher/theme-switcher';
import { Logo } from '../../../layout/logo/logo';
import { APP_NAME } from '../../../constants/brand';

@Component({
  host: {
    class:
      /* tw */ 'flex h-dvh min-h-0 flex-col overflow-hidden bg-white [--topbar-height:3rem] sm:[--topbar-height:3.5rem] dark:bg-slate-950',
  },
  imports: [LanguageSwitcher, Logo, RouterLink, ThemeSwitcher],
  selector: 'app-auth-layout',
  templateUrl: './auth-layout.html',
  styleUrl: './auth-layout.css',
})
export class AuthLayout {
  protected readonly homeLabel = $localize`:@@templateHomeLabel:${APP_NAME}:APP_NAME: home`;
}
