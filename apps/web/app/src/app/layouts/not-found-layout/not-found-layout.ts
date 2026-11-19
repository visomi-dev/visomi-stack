import { Component, inject } from '@angular/core';

import { LanguageSwitcher } from '../../i18n/language-switcher/language-switcher';
import { AuthNavigation } from '../../auth/shared/navigation';
import { Alert, Card, ThemeSwitcher } from '../../ui';
import { BrowserPrivacy } from '../../observability/browser-privacy/browser-privacy';
import { ConsentNotice } from '../../observability/consent-notice/consent-notice';
import { PrivacyLink } from '../../observability/privacy-link/privacy-link';

@Component({
  selector: 'app-not-found-layout',
  imports: [ConsentNotice, PrivacyLink, BrowserPrivacy, ThemeSwitcher, LanguageSwitcher, Alert, Card],
  templateUrl: './not-found-layout.html',
})
export class NotFoundLayout {
  readonly navigation = inject(AuthNavigation);
}
