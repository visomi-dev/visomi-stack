/* eslint-disable padding-line-between-statements */

import { webcrypto } from 'node:crypto';

import {
  BrowserEncryptedVault,
  BrowserVaultIntegrityError,
  BrowserVaultLockedError,
  BrowserVaultStorageError,
  type BrowserVaultAuthenticator,
  type BrowserVaultStorage,
  type VaultRecord,
} from './browser-encrypted-vault';

Object.assign(globalThis, { crypto: webcrypto });

const databases = new Map<
  string,
  { meta?: Parameters<BrowserVaultStorage['putMeta']>[0]; records: Map<string, VaultRecord> }
>();
const memoryFactory = async (name: string): Promise<BrowserVaultStorage> => {
  const state = databases.get(name) ?? { records: new Map<string, VaultRecord>() };
  databases.set(name, state);
  return {
    getMeta: async () => state.meta,
    putMeta: async (meta) => {
      state.meta = meta;
    },
    getRecord: async (id) => state.records.get(id),
    putRecord: async (record) => {
      state.records.set(record.envelopeId, record);
    },
    listRecords: async () => [...state.records.values()],
    close: () => undefined,
  };
};

const authenticator = async (): Promise<BrowserVaultAuthenticator> => {
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'HKDF', false, [
    'deriveKey',
  ]);
  return { initialize: async () => key, unlock: async () => key };
};

describe('BrowserEncryptedVault', () => {
  beforeEach(() => databases.clear());

  it('round-trips encrypted records, survives reopen, and denies locked access', async () => {
    const auth = await authenticator();
    const vault = await BrowserEncryptedVault.initialize('round-trip', 'workspace-1', auth, memoryFactory);
    const id = await vault.write('project-context', { secret: 'local only' });
    expect(await vault.read(id)).toEqual({ secret: 'local only' });
    expect((await vault.rawRecords())[0].envelope).not.toContain('local only');
    vault.lock();
    await expect(vault.read(id)).rejects.toBeInstanceOf(BrowserVaultLockedError);
    const reopened = await BrowserEncryptedVault.open('round-trip', auth, memoryFactory);
    await expect(reopened.read(id)).rejects.toBeInstanceOf(BrowserVaultLockedError);
    await reopened.unlock();
    await expect(reopened.read(id)).resolves.toEqual({ secret: 'local only' });
  });

  it('fails closed for tampered, malformed, and unsupported records', async () => {
    const auth = await authenticator();
    const vault = await BrowserEncryptedVault.initialize('tamper', 'workspace-1', auth, memoryFactory);
    const id = await vault.write('activity', { value: 42 });
    const storage = await memoryFactory('tamper');
    const record = (await storage.getRecord(id)) as VaultRecord;
    await storage.putRecord({ ...record, envelope: record.envelope.replace('"version":1', '"version":2') });
    await expect(vault.read(id)).rejects.toBeInstanceOf(BrowserVaultIntegrityError);
    await storage.putRecord({ ...record, envelope: '{not-json' });
    await expect(vault.read(id)).rejects.toBeInstanceOf(BrowserVaultIntegrityError);
  });

  it('denies authenticator failures and malformed vault metadata without exposing plaintext', async () => {
    const auth = await authenticator();
    const vault = await BrowserEncryptedVault.initialize('auth-denial', 'workspace-1', auth, memoryFactory);
    const id = await vault.write('secret', { value: 'never disclose' });
    vault.lock();
    const denied: BrowserVaultAuthenticator = {
      initialize: async () => {
        throw new Error('denied');
      },
      unlock: async () => {
        throw new Error('denied');
      },
    };
    const reopened = await BrowserEncryptedVault.open('auth-denial', denied, memoryFactory);
    await expect(reopened.unlock()).rejects.toBeInstanceOf(BrowserVaultIntegrityError);
    await expect(reopened.read(id)).rejects.toBeInstanceOf(BrowserVaultLockedError);

    const storage = await memoryFactory('auth-denial');
    const meta = await storage.getMeta();
    await storage.putMeta({ ...meta!, schemaVersion: 99 });
    await expect(BrowserEncryptedVault.open('auth-denial', auth, memoryFactory)).rejects.toThrow(
      'Unsupported or uninitialized browser vault',
    );
  });

  it('does not persist raw key material and exposes quota/transaction failures', async () => {
    const auth = await authenticator();
    let failWrites = false;
    const failingFactory = async (name: string): Promise<BrowserVaultStorage> => {
      const storage = await memoryFactory(name);
      return {
        ...storage,
        putRecord: async () => {
          if (failWrites) throw new BrowserVaultStorageError('IndexedDB quota exceeded.');
        },
      };
    };
    const vault = await BrowserEncryptedVault.initialize('quota', 'workspace-1', auth, failingFactory);
    failWrites = true;
    await expect(vault.write('secret', { value: 'rollback' })).rejects.toThrow('quota');
    expect(await vault.rawRecords()).toEqual([]);
  });

  it('rejects malformed base64 metadata during unlock', async () => {
    const auth = await authenticator();
    await BrowserEncryptedVault.initialize('bad-meta', 'workspace-1', auth, memoryFactory);
    const storage = await memoryFactory('bad-meta');
    const meta = await storage.getMeta();
    await storage.putMeta({ ...meta!, wrappedWorkspaceKey: '%%%not-base64%%%' });
    const vault = await BrowserEncryptedVault.open('bad-meta', auth, memoryFactory);
    await expect(vault.unlock()).rejects.toBeInstanceOf(BrowserVaultIntegrityError);
  });

  it('denies credential substitution and keeps protected plaintext and PRF output out of the persistence path', async () => {
    const protectedPlaintext = 'server-must-never-authorize-this-plaintext';
    const prfOutput = 'prf-output-must-never-cross-the-vault-boundary';
    const receivedByPersistence: unknown[] = [];
    const observingFactory = async (name: string): Promise<BrowserVaultStorage> => {
      const storage = await memoryFactory(name);
      return {
        ...storage,
        putMeta: async (meta) => {
          receivedByPersistence.push(meta);
          await storage.putMeta(meta);
        },
        putRecord: async (record) => {
          receivedByPersistence.push(record);
          await storage.putRecord(record);
        },
      };
    };
    const realAuthenticator: BrowserVaultAuthenticator = {
      initialize: async () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(21), 'HKDF', false, ['deriveKey']),
      unlock: async () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(21), 'HKDF', false, ['deriveKey']),
    };
    const substitutedAuthenticator: BrowserVaultAuthenticator = {
      initialize: async () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(22), 'HKDF', false, ['deriveKey']),
      unlock: async () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(22), 'HKDF', false, ['deriveKey']),
    };

    const vault = await BrowserEncryptedVault.initialize(
      'security-fixture',
      'workspace-1',
      realAuthenticator,
      observingFactory,
    );
    const id = await vault.write('project-context', { protectedPlaintext, prfOutput });
    const serializedPersistence = JSON.stringify(receivedByPersistence);
    expect(serializedPersistence).not.toContain(protectedPlaintext);
    expect(serializedPersistence).not.toContain(prfOutput);

    const reopened = await BrowserEncryptedVault.open('security-fixture', substitutedAuthenticator, observingFactory);
    await expect(reopened.unlock()).rejects.toBeInstanceOf(BrowserVaultIntegrityError);
    await expect(reopened.read(id)).rejects.toBeInstanceOf(BrowserVaultLockedError);
  });
});
