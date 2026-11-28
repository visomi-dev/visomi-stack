import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { VaultSyncStatus } from './vault-sync-status';

@Component({ template: '' })
class SyncStatusHost {}

afterEach(() => vi.restoreAllMocks());

it('maps the existing sync phases and shows online failures as retryable', () => {
  const sync = TestBed.inject(VaultSyncStatus);
  const retry = vi.fn();

  expect(sync.displayPhase()).toBe('idle');
  sync.setPending(true);
  expect(sync.displayPhase()).toBe('waiting');
  sync.show('syncing');
  expect(sync.displayPhase()).toBe('syncing');
  sync.show('retry', retry);
  expect(sync.displayPhase()).toBe('retry');
  sync.retry();
  expect(retry).toHaveBeenCalledOnce();
  sync.setPending(false);
  sync.show('synced');
  expect(sync.displayPhase()).toBe('synced');
});

it('shows pending backup offline and restores the online phase on reconnect', () => {
  const connection = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const sync = TestBed.inject(VaultSyncStatus);

  sync.setPending(true);
  sync.show('retry');

  const view = TestBed.createComponent(SyncStatusHost);

  view.detectChanges();
  expect(sync.displayPhase()).toBe('waiting');
  expect(sync.phase()).toBe('retry');
  connection.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  expect(sync.displayPhase()).toBe('retry');
  sync.setPending(false);
  sync.show('synced');
  connection.mockReturnValue(false);
  window.dispatchEvent(new Event('offline'));
  expect(sync.displayPhase()).toBe('offline');
});

it('keeps the last successful sync time across edits and clears it when the vault closes', () => {
  const time = vi.spyOn(Date, 'now').mockReturnValue(123);
  const sync = TestBed.inject(VaultSyncStatus);

  expect(sync.lastSyncedAt()).toBeNull();
  sync.show('synced');
  expect(sync.lastSyncedAt()).toBe(123);
  time.mockReturnValue(456);
  sync.show('idle');
  sync.show('syncing');
  sync.show('retry');
  expect(sync.lastSyncedAt()).toBe(123);
  sync.show('synced');
  expect(sync.lastSyncedAt()).toBe(456);
  sync.reset();
  expect(sync.displayPhase()).toBe('idle');
  expect(sync.lastSyncedAt()).toBeNull();
});
