import { Component, inject } from '@angular/core';

import { LanguageSwitcher } from '../i18n/language-switcher';
import { AuthNavigation } from '../auth/shared/navigation';
import { Alert, Card, ThemeSwitcher } from '../ui';
import { BrowserPrivacy } from '../observability/browser-privacy';

@Component({
  selector: 'app-not-found-layout',
  imports: [BrowserPrivacy, ThemeSwitcher, LanguageSwitcher, Alert, Card],
  templateUrl: './not-found-layout.html',
})
export class NotFoundLayout {
  readonly navigation = inject(AuthNavigation);
}
