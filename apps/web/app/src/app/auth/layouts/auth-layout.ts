import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Journey } from '../shared/journey';
import { AuthNavigation } from '../shared/navigation';
import { Alert, Card, ThemeSwitcher } from '../../ui';
import { LanguageSwitcher } from '../../i18n/language-switcher';
import { BrowserPrivacy } from '../../observability/browser-privacy';

@Component({
  selector: 'app-auth-layout',
  providers: [Journey],
  imports: [BrowserPrivacy, RouterOutlet, ThemeSwitcher, LanguageSwitcher, Alert, Card],
  templateUrl: './auth-layout.html',
})
export class AuthLayout {
  readonly navigation = inject(AuthNavigation);
}
