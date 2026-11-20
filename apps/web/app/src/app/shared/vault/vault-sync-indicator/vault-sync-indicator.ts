import { Component, computed, inject } from '@angular/core';

import { Button } from '../../../ui';
import { VaultSyncStatus } from '../vault-sync-status';

@Component({
  selector: 'app-vault-sync-indicator',
  imports: [Button],
  host: { class: 'inline-grid size-9 shrink-0 place-items-center' },
  templateUrl: './vault-sync-indicator.html',
})
export class VaultSyncIndicator {
  protected readonly sync = inject(VaultSyncStatus);

  protected readonly label = computed(() => {
    switch (this.sync.phase()) {
      case 'syncing':
        return $localize`:@@vaultSyncInProgress:Syncing Vault…`;
      case 'synced':
        return $localize`:@@vaultSyncComplete:Vault synced`;
      case 'retry':
        return $localize`:@@vaultSyncFailed:Vault sync failed`;
      default:
        return '';
    }
  });
}
