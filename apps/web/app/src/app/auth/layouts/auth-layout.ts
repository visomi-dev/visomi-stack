import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Journey } from '../shared/journey';
import { AuthNavigation } from '../shared/navigation';
import { Alert, Card, ThemeSwitcher } from '../../ui';

import { AuthLanguage } from './language';

@Component({
  selector: 'app-auth-layout',
  providers: [Journey],
  imports: [RouterOutlet, ThemeSwitcher, AuthLanguage, Alert, Card],
  templateUrl: './auth-layout.html',
})
export class AuthLayout {
  readonly navigation = inject(AuthNavigation);
}
