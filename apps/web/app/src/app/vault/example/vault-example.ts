import { Component } from '@angular/core';

import { DatabaseExample } from '../../db/example/example';
import { NavigationHeading } from '../../shared/navigation-heading';
import { Heading } from '../../ui';

@Component({
  selector: 'app-vault-example',
  imports: [DatabaseExample, Heading, NavigationHeading],
  templateUrl: './vault-example.html',
})
export class VaultExample {}
