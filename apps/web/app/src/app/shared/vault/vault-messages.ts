export function vaultMessage(state: string): string {
  switch (state) {
    case 'pin-invalid':
      return $localize`:@@vaultPinInvalid:Enter a six-digit PIN. For initial setup, enter the same PIN twice.`;
    case 'sync_history_expired':
      return $localize`:@@vaultHistoryExpired:This device is older than the retained synchronization history. Keep its encrypted copy and pending changes. Recovery requires trusted client state; synchronization will not reset its checkpoint.`;
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
      return $localize`:@@vaultCorrupt:Integrity could not be verified. Keep the encrypted copy and restore from a trusted backup.`;
    case 'quota':
      return $localize`:@@vaultQuota:Storage or encryption limits were reached. Export an encrypted backup before changing storage.`;
    case 'recovery-required':
      return $localize`:@@vaultRecovery:This device has no usable wrapped key. Use your product's explicit recovery or device approval flow. Resetting a password does not recover private data.`;
    case 'unsupported-prf':
      return $localize`:@@vaultNoPrf:This credential or browser does not support the required private unlock. Use a supported device. The server cannot unlock this resource.`;
    case 'cancelled':
      return $localize`:@@vaultCancelled:Unlock was cancelled. Your private resources remain locked.`;
    case 'origin-mismatch':
      return $localize`:@@vaultOrigin:This unlock credential belongs to a different site. Return to the original site.`;
    case 'revision-conflict':
    case 'sync_conflict':
    case 'revision_conflict':
    case 'idempotency_conflict':
    case 'device_state_conflict':
      return $localize`:@@vaultConflict:A newer encrypted change exists. Synchronize and resolve the conflict before trying again.`;
    default:
      return $localize`:@@vaultUnavailable:Private storage is unavailable on this device. No server-readable fallback was enabled.`;
  }
}
