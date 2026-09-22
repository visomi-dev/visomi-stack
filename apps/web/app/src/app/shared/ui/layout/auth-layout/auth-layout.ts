import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LangSwitcher, type LanguageOption } from '../lang-switcher/lang-switcher';
import { ThemeSwitcher } from '../../../layout/theme-switcher/theme-switcher';
import { Logo } from '../../../layout/logo/logo';
import { APP_NAME } from '../../../constants/brand';

const DEFAULT_LANGUAGES: ReadonlyArray<LanguageOption> = Object.freeze([
  { code: 'EN', label: 'English' },
  { code: 'ES', label: 'Español' },
]);

@Component({
  host: {
    class:
      /* tw */ 'flex h-dvh min-h-0 flex-col overflow-hidden bg-white [--topbar-height:3rem] sm:[--topbar-height:3.5rem] dark:bg-slate-950',
  },
  imports: [LangSwitcher, Logo, RouterLink, ThemeSwitcher],
  selector: 'app-auth-layout',
  templateUrl: './auth-layout.html',
  styleUrl: './auth-layout.css',
})
export class AuthLayout {
  protected readonly homeLabel = $localize`:@@templateHomeLabel:${APP_NAME}:APP_NAME: home`;
  readonly languages = DEFAULT_LANGUAGES;
}
