import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LangSwitcher, type LanguageOption } from '../lang-switcher/lang-switcher';
import { ThemeSwitcher } from '../../../layout/theme-switcher/theme-switcher';
import { Logo } from '../../../layout/logo/logo';

const DEFAULT_LANGUAGES: ReadonlyArray<LanguageOption> = Object.freeze([
  { code: 'EN', label: 'English' },
  { code: 'ES', label: 'Español' },
  { code: 'PT-BR', label: 'Português (Brasil)' },
  { code: 'JA', label: '日本語' },
  { code: 'DE', label: 'Deutsch' },
  { code: 'ZH', label: '中文' },
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
  readonly languages = DEFAULT_LANGUAGES;
}
