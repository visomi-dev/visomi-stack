import { Component, inject } from '@angular/core';

import { DatabaseExample } from '../../db/example/example';
import { PersistenceDemos } from '../../db/persistence-demos';
import { VaultDemo } from '../demo/demo';

@Component({
  selector: 'app-vault-example',
  imports: [VaultDemo, DatabaseExample],
  templateUrl: './vault-example.html',
})
export class VaultExample {
  protected readonly demos = inject(PersistenceDemos);
}
