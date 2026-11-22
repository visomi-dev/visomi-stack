import type { Routes } from '@angular/router';

import { DatabaseExample } from '../../db/example/example';
import { VaultUnlock } from '../unlock/vault-unlock';
import { vaultUnlockTargetGuard } from '../unlock/vault-unlock-target';

import { VaultExample } from './vault-example';

export const vaultRoutes: Routes = [
  {
    path: '',
    component: VaultExample,
    data: { backedSample: true },
    // Load both views on entry so an open vault can still be locked and unlocked offline.
    children: [
      { path: '', pathMatch: 'full', component: DatabaseExample },
      {
        path: 'unlock',
        component: VaultUnlock,
        canActivate: [vaultUnlockTargetGuard],
        runGuardsAndResolvers: 'always',
      },
    ],
  },
];
