import { Component, inject } from '@angular/core';

import { LanguageSwitcher } from '../i18n/language-switcher';
import { AuthNavigation } from '../auth/shared/navigation';
import { Alert, Card, ThemeSwitcher } from '../ui';

@Component({
  selector: 'app-not-found-layout',
  imports: [ThemeSwitcher, LanguageSwitcher, Alert, Card],
  templateUrl: './not-found-layout.html',
})
export class NotFoundLayout {
  readonly navigation = inject(AuthNavigation);
}
