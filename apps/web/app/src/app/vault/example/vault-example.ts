import { Component, inject } from '@angular/core';

import { DatabaseExample } from '../../db/example/example';
import { ExampleAvailability } from '../../db/example-availability';
import { VaultDemo } from '../demo/demo';

@Component({
  selector: 'app-vault-example',
  imports: [VaultDemo, DatabaseExample],
  templateUrl: './vault-example.html',
})
export class VaultExample {
  protected readonly examples = inject(ExampleAvailability);
}
