import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';

import { Badge, Button } from '../../../ui';
import { VaultSyncStatus } from '../vault-sync-status';

@Component({
  selector: 'app-vault-sync-indicator',
  imports: [Badge, Button, DatePipe],
  host: {
    class: 'inline-flex min-w-0 items-center justify-center gap-1 max-sm:size-9',
    '[class.absolute]': "sync.displayPhase() === 'idle'",
  },
  templateUrl: './vault-sync-indicator.html',
})
export class VaultSyncIndicator {
  protected readonly sync = inject(VaultSyncStatus);

  protected readonly label = computed(() => {
    switch (this.sync.displayPhase()) {
      case 'syncing':
        return $localize`:@@vaultSyncInProgress:Syncing Vault…`;
      case 'synced':
        return $localize`:@@vaultSyncComplete:Vault synced`;
      case 'retry':
        return $localize`:@@vaultSyncFailed:Vault sync failed`;
      case 'waiting':
        return $localize`:@@vaultSyncWaiting:Waiting for backup`;
      case 'offline':
        return $localize`:@@vaultSyncOffline:Vault offline`;
      default:
        return '';
    }
  });
}
