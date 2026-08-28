import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  LocalEncryptedVault,
  VaultIntegrityError,
  VaultLockedError,
  VaultRecoveryBlockedError,
} from './local-encrypted-vault';

const vmk = Buffer.alloc(32, 7);
const wrongVmk = Buffer.alloc(32, 8);

function vaultPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'themis-vault-')), 'vault.sqlite');
}

describe('local encrypted vault proof', () => {
  it('round-trips records and persists only encrypted envelopes', () => {
    const path = vaultPath();
    const vault = LocalEncryptedVault.initialize(path, { workspaceId: 'workspace-001', vmk });
    const id = vault.write('project-context', { title: 'Secret project', status: 'active' });

    expect(vault.read(id)).toEqual({ title: 'Secret project', status: 'active' });
    expect(vault.rawRecords()[0]).not.toContain('Secret project');
    vault.close();

    const reopened = LocalEncryptedVault.open(path, vmk);

    expect(reopened.read(id)).toEqual({ title: 'Secret project', status: 'active' });
    reopened.close();
  });

  it('enforces lock/unlock and blocks recovery without a recovery key', () => {
    const vault = LocalEncryptedVault.initialize(vaultPath(), { workspaceId: 'workspace-001', vmk });
    const id = vault.write('project-context', { value: 1 });

    vault.lock();
    expect(() => vault.read(id)).toThrow(VaultLockedError);
    expect(() => vault.write('project-context', { value: 2 })).toThrow(VaultLockedError);
    expect(() => vault.recover()).toThrow(VaultRecoveryBlockedError);
    vault.unlock(vmk);
    expect(vault.read(id)).toEqual({ value: 1 });
    vault.close();
  });

  it('rejects wrong key material and tampered envelopes safely', () => {
    const path = vaultPath();
    const vault = LocalEncryptedVault.initialize(path, { workspaceId: 'workspace-001', vmk });
    const id = vault.write('project-context', { value: 1 });

    vault.close();

    expect(() => LocalEncryptedVault.open(path, wrongVmk)).toThrow(/could not be unlocked/);
    const reopened = LocalEncryptedVault.open(path, vmk);
    const raw = reopened.rawRecords()[0].replace('project-context', 'other-context');
    const database = new DatabaseSync(path);

    database.prepare('UPDATE vault_records SET envelope = ? WHERE envelope_id = ?').run(raw, id);
    database.close();
    expect(() => reopened.read(id)).toThrow(VaultIntegrityError);
    reopened.close();
  });

  it('rejects unsupported vault versions', () => {
    const path = vaultPath();
    const vault = LocalEncryptedVault.initialize(path, { workspaceId: 'workspace-001', vmk });

    vault.close();
    const raw = new DatabaseSync(path);

    raw.prepare('UPDATE vault_meta SET schema_version = 2').run();
    raw.close();
    expect(() => LocalEncryptedVault.open(path, vmk)).toThrow(/Unsupported local vault version/);
  });
});
