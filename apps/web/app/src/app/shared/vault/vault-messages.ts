export function vaultMessage(state: string): string {
  switch (state) {
    case 'pin-invalid':
      return $localize`:@@vaultPinInvalid:Enter a 6-digit PIN. When setting it up, enter the same PIN twice.`;
    case 'sync_history_expired':
      return $localize`:@@vaultHistoryExpired:This device is older than the retained synchronization history. Keep its encrypted copy and pending changes. Recovery requires trusted client state; synchronization will not reset its checkpoint.`;
    case 'vault_backup_unavailable':
      return $localize`:@@vaultBackupStorageRetry:We couldn’t verify the encrypted backup. Your local data is unchanged. Try again later.`;
    case 'operation_expired':
      return $localize`:@@vaultOperationExpired:The retry window for this pending change expired. Keep the encrypted copy, synchronize, and explicitly resolve it before creating a new operation.`;
    case 'locked':
    case 'stale-operation':
      return $localize`:@@vaultLocked:Private resources are locked.`;
    case 'ready':
      return $localize`:@@vaultReady:Unlocked on this device.`;
    case 'corrupt':
    case 'integrity-failure':
    case 'context-mismatch':
      return $localize`:@@vaultCorrupt:We couldn’t verify the encrypted data. Keep the encrypted copy and restore from a trusted backup.`;
    case 'quota':
      return $localize`:@@vaultQuota:You’ve reached a storage or encryption limit.`;
    case 'recovery-required':
      return $localize`:@@vaultRecovery:This device doesn’t have a usable key. Use the product’s recovery or device approval process. Resetting a password won’t recover private data.`;
    case 'unsupported-prf':
      return $localize`:@@vaultNoPrf:This credential or browser can’t unlock private resources. Use a compatible device. The server can’t unlock this resource.`;
    case 'cancelled':
      return $localize`:@@vaultCancelled:Unlock canceled. Your private resources are still locked.`;
    case 'origin-mismatch':
      return $localize`:@@vaultOrigin:This credential belongs to a different site. Go back to the site where you set it up.`;
    case 'revision-conflict':
    case 'sync_conflict':
    case 'revision_conflict':
    case 'idempotency_conflict':
    case 'device_state_conflict':
      return $localize`:@@vaultConflict:There’s a newer encrypted change. Sync and resolve the conflict before trying again.`;
    default:
      return $localize`:@@vaultUnavailable:Private storage is unavailable on this device. The server can’t read your private data.`;
  }
}
