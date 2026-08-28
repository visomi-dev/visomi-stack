import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from '@playwright/test';
import { build } from 'esbuild';

import type * as BrowserVaultModule from '../libs/shared/src/lib/crypto/browser-encrypted-vault';

const artifactPath = 'artifacts/zk-018/run-080/native-browser-vault.json';
const tempDirectory = await mkdtemp(join(tmpdir(), 'themis-browser-vault-'));
const bundlePath = join(tempDirectory, 'vault.js');
await build({
  entryPoints: ['libs/shared/src/lib/crypto/browser-encrypted-vault.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'VaultModule',
  outfile: bundlePath,
  platform: 'browser',
});

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><title>vault smoke</title>');
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Smoke server did not start.');

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.addScriptTag({ path: bundlePath });
  const observed = await page.evaluate(async () => {
    const {
      BrowserEncryptedVault,
      BrowserVaultIntegrityError,
      BrowserVaultLockedError,
      BrowserVaultStorageError,
      indexedDbStorage,
    } = (globalThis as typeof globalThis & { VaultModule: typeof BrowserVaultModule }).VaultModule;
    type StoredValue = { meta: Record<string, unknown>; record: Record<string, unknown> };
    const openDatabase = (name: string, version?: number): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const readStored = async (name: string, id: string): Promise<StoredValue> => {
      const database = await openDatabase(name);
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(['meta', 'records'], 'readonly');
        const metaRequest = transaction.objectStore('meta').get('vault');
        const recordRequest = transaction.objectStore('records').get(id);
        transaction.oncomplete = () => {
          database.close();
          resolve({ meta: metaRequest.result, record: recordRequest.result });
        };
        transaction.onerror = () => reject(transaction.error);
      });
    };
    const expectError = async (promise: Promise<unknown>, errorType: string): Promise<boolean> =>
      promise.then(
        () => false,
        (error: unknown) => error instanceof Error && error.name === errorType,
      );
    let vmk: CryptoKey | undefined;
    const authenticatorMaterial = new Uint8Array(32).fill(7);
    const authenticator = {
      initialize: async () => {
        vmk = await crypto.subtle.importKey('raw', authenticatorMaterial, 'HKDF', false, ['deriveKey']);
        return vmk;
      },
      unlock: async () => {
        vmk ??= await crypto.subtle.importKey('raw', authenticatorMaterial, 'HKDF', false, ['deriveKey']);
        return vmk;
      },
    };
    const vault = await BrowserEncryptedVault.initialize(
      'native-smoke',
      'workspace-native',
      authenticator,
      indexedDbStorage,
    );
    const id = await vault.write('project-context', { secret: 'browser-local-only' });
    const stored = await readStored('themis-vault:native-smoke', id);
    const rawKeyExportRejected = await crypto.subtle.exportKey('raw', vmk!).then(
      () => false,
      () => true,
    );

    vault.lock();
    const locked = await expectError(vault.read(id), BrowserVaultLockedError.name);
    await vault.unlock();
    const original = (await vault.rawRecords())[0];
    const database = await openDatabase('themis-vault:native-smoke');
    const tamperTransaction = database.transaction('records', 'readwrite');
    tamperTransaction
      .objectStore('records')
      .put({ ...original, envelope: original.envelope.replace(/ciphertext":"./, 'ciphertext":"x') });
    await new Promise<void>((resolve, reject) => {
      tamperTransaction.oncomplete = () => resolve();
      tamperTransaction.onerror = () => reject(tamperTransaction.error);
    });
    const tampered = await expectError(vault.read(id), BrowserVaultIntegrityError.name);
    const malformedTransaction = database.transaction('records', 'readwrite');
    malformedTransaction.objectStore('records').put({ ...original, envelope: '{not-json' });
    await new Promise<void>((resolve, reject) => {
      malformedTransaction.oncomplete = () => resolve();
      malformedTransaction.onerror = () => reject(malformedTransaction.error);
    });
    const malformed = await expectError(vault.read(id), BrowserVaultIntegrityError.name);
    const unsupportedTransaction = database.transaction('records', 'readwrite');
    unsupportedTransaction
      .objectStore('records')
      .put({ ...original, envelope: original.envelope.replace('"version":1', '"version":2') });
    await new Promise<void>((resolve, reject) => {
      unsupportedTransaction.oncomplete = () => resolve();
      unsupportedTransaction.onerror = () => reject(unsupportedTransaction.error);
    });
    const unsupported = await expectError(vault.read(id), BrowserVaultIntegrityError.name);
    database.close();

    const reloadId = await vault.write('reload-proof', { value: 'survives browser reload' });
    const nativeRoundTrip = await vault.read<{ value: string }>(reloadId);

    await vault.close();
    const denied = await BrowserEncryptedVault.open(
      'native-smoke',
      {
        initialize: async () => {
          throw new Error('denied');
        },
        unlock: async () => {
          throw new Error('denied');
        },
      },
      indexedDbStorage,
    );
    const authenticatorDenied = await expectError(denied.unlock(), BrowserVaultIntegrityError.name);
    const deniedLocked = await expectError(denied.read(id), BrowserVaultLockedError.name);
    denied.close();

    const quotaBase = await indexedDbStorage('native-quota');
    const quotaVault = await BrowserEncryptedVault.initialize(
      'native-quota',
      'workspace-native',
      authenticator,
      async () => ({
        ...quotaBase,
        putRecord: async () => {
          throw new BrowserVaultStorageError('IndexedDB quota exceeded.');
        },
      }),
    );
    const quota = await expectError(quotaVault.write('quota', { value: 'rejected' }), BrowserVaultStorageError.name);
    quotaVault.close();

    const rollbackDatabase = await openDatabase('themis-vault:native-smoke');
    const rollbackTransaction = rollbackDatabase.transaction('records', 'readwrite');
    rollbackTransaction.objectStore('records').put({ envelopeId: 'rolled-back', envelope: 'not persisted' });
    rollbackTransaction.abort();
    const rollback = await new Promise<boolean>((resolve) => {
      rollbackTransaction.onabort = async () => {
        const check = await readStored('themis-vault:native-smoke', 'rolled-back').catch(() => undefined);
        resolve(check?.record === undefined);
      };
    });
    rollbackDatabase.close();
    const abortDatabase = await openDatabase('themis-vault:native-smoke');
    const abortTransaction = abortDatabase.transaction('records', 'readwrite');
    const abortRequest = abortTransaction.objectStore('records').put({ envelopeId: 'abort', envelope: 'abort' });
    abortTransaction.abort();
    const transactionAbort = await new Promise<boolean>((resolve) => {
      abortRequest.onerror = () =>
        resolve(abortTransaction.error === null || abortTransaction.error instanceof DOMException);
    });
    abortDatabase.close();

    const deleteDatabase = (name: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`Database ${name} remained blocked.`));
      });
    let migrationVmk: CryptoKey | undefined;
    const migrationAuthenticator = {
      initialize: async () => {
        migrationVmk = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'HKDF', false, [
          'deriveKey',
        ]);
        return migrationVmk;
      },
      unlock: async () => migrationVmk!,
    };
    const seed = await BrowserEncryptedVault.initialize(
      'migration-seed',
      'workspace-migration',
      migrationAuthenticator,
      indexedDbStorage,
    );
    const seedId = await seed.write('migration', { value: 1 });
    const seedMeta = (await readStored('themis-vault:migration-seed', seedId)).meta;
    seed.close();
    await deleteDatabase('themis-vault:migration');
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('themis-vault:migration', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('meta', { keyPath: 'key' });
        request.result.createObjectStore('records', { keyPath: 'envelopeId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const legacyMeta = legacy.transaction('meta', 'readwrite');
    legacyMeta.objectStore('meta').put({ ...seedMeta, schemaVersion: 1 });
    await new Promise<void>((resolve, reject) => {
      legacyMeta.oncomplete = () => resolve();
      legacyMeta.onerror = () => reject(legacyMeta.error);
    });
    legacy.close();
    // The migrated metadata is inspected before the normal vault-open assertion below.
    const migrated = await BrowserEncryptedVault.open('migration', migrationAuthenticator, indexedDbStorage);
    const migratedMeta = await readStored('themis-vault:migration', 'missing');
    migrated.close();
    const migration = migratedMeta.meta.schemaVersion === 2;
    return {
      origin: location.origin,
      storedKeys: Object.keys(stored.record).sort(),
      metadataKeys: Object.keys(stored.meta).sort(),
      containsPlaintext: JSON.stringify(stored).includes('browser-local-only'),
      containsRawKey: JSON.stringify(stored).includes('workspaceKey') || JSON.stringify(stored).includes('vmk'),
      rawKeyExportRejected,
      locked,
      tampered,
      malformed,
      unsupported,
      authenticatorDenied,
      deniedLocked,
      quota,
      rollback,
      transactionAbort,
      migration,
      reloadId,
      nativeRoundTrip,
    };
  });
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto(`http://localhost:${address.port}`);
  const otherOriginEmpty = await otherPage.evaluate(
    async () => !(await indexedDB.databases()).some(({ name }) => name === 'themis-vault:native-smoke'),
  );
  await otherContext.close();
  await page.reload();
  await page.addScriptTag({ path: bundlePath });
  const reloaded = await page.evaluate(async (envelopeId: string) => {
    const { BrowserEncryptedVault, BrowserVaultLockedError, indexedDbStorage } = (
      globalThis as typeof globalThis & { VaultModule: typeof BrowserVaultModule }
    ).VaultModule;
    const material = new Uint8Array(32).fill(7);
    const authenticator = {
      initialize: async () => crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveKey']),
      unlock: async () => crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveKey']),
    };
    const vault = await BrowserEncryptedVault.open('native-smoke', authenticator, indexedDbStorage);
    const lockedAfterReload = await vault.read(envelopeId).then(
      () => false,
      (error: unknown) => error instanceof BrowserVaultLockedError,
    );
    await vault.unlock();
    const value = await vault.read<{ value: string }>(envelopeId);
    vault.close();
    return { lockedAfterReload, readAfterUnlock: value };
  }, observed.reloadId);
  const result = { ...observed, ...reloaded, otherOriginEmpty };
  await mkdir('artifacts/zk-018/run-080', { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
  if (
    result.containsPlaintext ||
    result.containsRawKey ||
    !result.rawKeyExportRejected ||
    !result.locked ||
    !result.tampered ||
    !result.malformed ||
    !result.unsupported ||
    !result.authenticatorDenied ||
    !result.deniedLocked ||
    !result.quota ||
    !result.rollback ||
    !result.transactionAbort ||
    !result.migration ||
    result.nativeRoundTrip.value !== 'survives browser reload' ||
    !result.lockedAfterReload ||
    result.readAfterUnlock.value !== 'survives browser reload' ||
    !result.otherOriginEmpty
  )
    throw new Error(`Native browser vault smoke failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ artifactPath, ...result }, null, 2));
} finally {
  await browser.close();
  server.close();
  await rm(tempDirectory, { recursive: true, force: true });
}
