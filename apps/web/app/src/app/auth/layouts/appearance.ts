import { Component } from '@angular/core';

import { ThemeSwitcher } from '../../ui';

@Component({
  selector: 'app-auth-appearance',
  imports: [ThemeSwitcher],
  templateUrl: './appearance.html',
})
export class Appearance {}
