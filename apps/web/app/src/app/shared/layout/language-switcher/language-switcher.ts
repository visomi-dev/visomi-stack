import { DOCUMENT } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Icon } from '../../ui/media/icon/icon';
import { Dropdown } from '../../ui/overlays/dropdown/dropdown';

type Locale = 'en' | 'es';

const APP_BASE_URL = '/app';
const ENGLISH_LOCALE_SEGMENT = 'en';

@Component({
  host: {
    class: /* tw */ 'inline-block',
  },
  imports: [Dropdown, Icon, RouterLink],
  selector: 'app-language-switcher',
  templateUrl: './language-switcher.html',
  styleUrl: './language-switcher.css',
})
export class LanguageSwitcher {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);

  currentLocale() {
    return this.document.documentElement.lang.startsWith('es') ? 'es' : 'en';
  }

  localeUrl(locale: Locale) {
    const routePath = this.router.url === '/' ? '' : this.router.url;

    return locale === 'es' ? `${APP_BASE_URL}/es${routePath}` : `${APP_BASE_URL}/${ENGLISH_LOCALE_SEGMENT}${routePath}`;
  }

  localeLabel(locale: Locale) {
    return locale === 'es'
      ? $localize`:@@languageSwitcherSpanish:Switch to Spanish`
      : $localize`:@@languageSwitcherEnglish:Switch to English`;
  }

  currentLocaleLabel() {
    return this.currentLocale().toUpperCase();
  }

  readonly currentLocaleSignal = computed(() => this.currentLocale());
}
