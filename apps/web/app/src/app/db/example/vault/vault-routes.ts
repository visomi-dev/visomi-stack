import type { Routes } from '@angular/router';

import { DatabaseExample } from '../example';
import { VaultUnlock } from '../../../vault/unlock/vault-unlock';
import { vaultUnlockTargetGuard } from '../../../vault/unlock/vault-unlock-target';

import { VaultExample } from './vault-example';

export const vaultRoutes: Routes = [
  {
    path: '',
    component: VaultExample,
    data: { backedSample: true },
    // Load both views on entry so an open vault can still be locked and unlocked offline.
    children: [
      { path: 'db-example/vault', pathMatch: 'full', component: DatabaseExample },
      {
        path: 'vault/unlock',
        component: VaultUnlock,
        data: { vaultUnlock: true },
        canActivate: [vaultUnlockTargetGuard],
        runGuardsAndResolvers: 'always',
      },
    ],
  },
];
