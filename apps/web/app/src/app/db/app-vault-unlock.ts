import { Component, inject } from '@angular/core';

import { Button, Field, Heading, Input, Text } from '../ui';

import { AppVaults } from './app-vaults';

@Component({
  selector: 'app-vault-unlock',
  imports: [Button, Field, Heading, Input, Text],
  templateUrl: './app-vault-unlock.html',
})
export class AppVaultUnlock {
  readonly access = inject(AppVaults);
}
