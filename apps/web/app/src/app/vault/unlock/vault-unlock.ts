import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ExampleWorkspace } from '../../db/example-workspace';
import { NavigationHeading } from '../../shared/navigation-heading';
import { Button, Card, Field, Heading, Link, PinInput } from '../../ui';

@Component({
  selector: 'app-vault-unlock',
  imports: [Button, Card, Field, Heading, Link, NavigationHeading, PinInput, RouterLink],
  templateUrl: './vault-unlock.html',
})
export class VaultUnlock {
  readonly workspace = inject(ExampleWorkspace);
}
