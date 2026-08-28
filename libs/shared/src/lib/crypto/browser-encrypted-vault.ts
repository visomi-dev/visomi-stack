/* eslint-disable padding-line-between-statements */

import {
  deserializeEncryptedEnvelope,
  parseEncryptedEnvelope,
  serializeEncryptedEnvelope,
  type EncryptedEnvelope,
} from './encrypted-envelope';

const ENVELOPE_VERSION = 1;
const VAULT_SCHEMA_VERSION = 2;
const LEGACY_VAULT_SCHEMA_VERSION = 1;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type BrowserVaultAuthenticator = {
  initialize(): Promise<CryptoKey>;
  unlock(): Promise<CryptoKey>;
};

export type BrowserVaultStorage = {
  getMeta(): Promise<VaultMeta | undefined>;
  putMeta(meta: VaultMeta): Promise<void>;
  getRecord(envelopeId: string): Promise<VaultRecord | undefined>;
  putRecord(record: VaultRecord): Promise<void>;
  listRecords(): Promise<VaultRecord[]>;
  close(): void;
};

export type BrowserVaultStorageFactory = (name: string) => Promise<BrowserVaultStorage>;

type VaultMeta = {
  key: 'vault';
  schemaVersion: number;
  workspaceId: string;
  salt: string;
  wrapNonce: string;
  wrappedWorkspaceKey: string;
};

export type VaultRecord = { envelopeId: string; envelope: string };

export class BrowserVaultLockedError extends Error {
  constructor() {
    super('The browser vault is locked.');
    this.name = 'BrowserVaultLockedError';
  }
}

export class BrowserVaultIntegrityError extends Error {
  constructor() {
    super('The browser vault record failed integrity verification.');
    this.name = 'BrowserVaultIntegrityError';
  }
}

export class BrowserVaultStorageError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BrowserVaultStorageError';
  }
}

function randomBytes(length: number): Uint8Array {
  const result = new Uint8Array(length);
  crypto.getRandomValues(result);
  return result;
}

function base64(value: Uint8Array): string {
  let binary = '';
  value.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bufferSource(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function canonicalObject(value: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

async function deriveWrappingKey(vmk: CryptoKey, salt: Uint8Array, workspaceId: string): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bufferSource(salt),
      info: bufferSource(encoder.encode(`themis/workspace-wrap/v1/${workspaceId}`)),
    },
    vmk,
    { name: 'AES-GCM', length: KEY_BYTES * 8 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrapWorkspaceKey(vmk: CryptoKey, workspaceKey: CryptoKey, salt: Uint8Array, workspaceId: string) {
  const wrappingKey = await deriveWrappingKey(vmk, salt, workspaceId);
  const nonce = randomBytes(NONCE_BYTES);
  const wrapped = await crypto.subtle.wrapKey('raw', workspaceKey, wrappingKey, {
    name: 'AES-GCM',
    iv: bufferSource(nonce),
  });
  return { nonce: base64(nonce), wrapped: base64(new Uint8Array(wrapped)) };
}

async function unwrapWorkspaceKey(meta: VaultMeta, vmk: CryptoKey): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(vmk, unbase64(meta.salt), meta.workspaceId);
  return crypto.subtle.unwrapKey(
    'raw',
    bufferSource(unbase64(meta.wrappedWorkspaceKey)),
    wrappingKey,
    { name: 'AES-GCM', iv: bufferSource(unbase64(meta.wrapNonce)) },
    { name: 'AES-GCM', length: KEY_BYTES * 8 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(workspaceKey: CryptoKey, value: unknown, associatedData: Record<string, string>) {
  const nonce = randomBytes(NONCE_BYTES);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: bufferSource(nonce),
        additionalData: bufferSource(encoder.encode(canonicalObject(associatedData))),
        tagLength: 128,
      },
      workspaceKey,
      bufferSource(encoder.encode(JSON.stringify(value))),
    ),
  );
  return { nonce, ciphertext: encrypted.slice(0, -16), authTag: encrypted.slice(-16) };
}

async function decrypt(workspaceKey: CryptoKey, envelope: EncryptedEnvelope): Promise<unknown> {
  const ciphertext = unbase64(envelope.ciphertext);
  const tag = unbase64(envelope.authTag);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bufferSource(unbase64(envelope.nonce)),
        additionalData: bufferSource(encoder.encode(canonicalObject(envelope.associatedData))),
        tagLength: 128,
      },
      workspaceKey,
      combined,
    );
    return JSON.parse(decoder.decode(plaintext)) as unknown;
  } catch {
    throw new BrowserVaultIntegrityError();
  }
}

export class BrowserEncryptedVault {
  private workspaceKey: CryptoKey | undefined;

  private constructor(
    private readonly storage: BrowserVaultStorage,
    private readonly authenticator: BrowserVaultAuthenticator,
  ) {}

  static async initialize(
    name: string,
    workspaceId: string,
    authenticator: BrowserVaultAuthenticator,
    factory: BrowserVaultStorageFactory = indexedDbStorage,
  ): Promise<BrowserEncryptedVault> {
    const storage = await factory(name);
    if (await storage.getMeta()) {
      storage.close();
      throw new Error('Browser vault is already initialized.');
    }
    const vmk = await authenticator.initialize();
    const salt = randomBytes(16);
    const workspaceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_BYTES * 8 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const wrapped = await wrapWorkspaceKey(vmk, workspaceKey, salt, workspaceId);
    await storage.putMeta({
      key: 'vault',
      schemaVersion: VAULT_SCHEMA_VERSION,
      workspaceId,
      salt: base64(salt),
      wrapNonce: wrapped.nonce,
      wrappedWorkspaceKey: wrapped.wrapped,
    });
    const vault = new BrowserEncryptedVault(storage, authenticator);
    vault.workspaceKey = workspaceKey;
    return vault;
  }

  static async open(
    name: string,
    authenticator: BrowserVaultAuthenticator,
    factory: BrowserVaultStorageFactory = indexedDbStorage,
  ): Promise<BrowserEncryptedVault> {
    const storage = await factory(name);
    const meta = await storage.getMeta();
    if (!meta || meta.schemaVersion !== VAULT_SCHEMA_VERSION) {
      storage.close();
      throw new Error('Unsupported or uninitialized browser vault.');
    }
    return new BrowserEncryptedVault(storage, authenticator);
  }

  async unlock(): Promise<void> {
    const meta = await this.storage.getMeta();
    if (!meta || meta.schemaVersion !== VAULT_SCHEMA_VERSION) throw new Error('Unsupported browser vault version.');
    try {
      this.workspaceKey = await unwrapWorkspaceKey(meta, await this.authenticator.unlock());
    } catch {
      throw new BrowserVaultIntegrityError();
    }
  }

  lock(): void {
    this.workspaceKey = undefined;
  }

  async write(recordType: string, value: unknown): Promise<string> {
    const key = this.requireKey();
    const meta = await this.storage.getMeta();
    if (!meta) throw new Error('Browser vault metadata is missing.');
    const envelopeId = base64(randomBytes(16));
    const associatedData = { purpose: recordType, workspace: meta.workspaceId };
    const encrypted = await encrypt(key, value, associatedData);
    const envelope = parseEncryptedEnvelope({
      format: 'themis.encrypted-envelope',
      version: ENVELOPE_VERSION,
      kind: 'local-record',
      envelopeId,
      workspaceId: meta.workspaceId,
      recordType,
      revision: 1,
      createdAt: new Date().toISOString(),
      associatedData,
      metadata: { contentType: 'application/json' },
      nonce: base64(encrypted.nonce),
      ciphertext: base64(encrypted.ciphertext),
      authTag: base64(encrypted.authTag),
    });
    await this.storage.putRecord({ envelopeId, envelope: serializeEncryptedEnvelope(envelope) });
    return envelopeId;
  }

  async read<T>(envelopeId: string): Promise<T> {
    const key = this.requireKey();
    const record = await this.storage.getRecord(envelopeId);
    if (!record) throw new Error('Browser vault record was not found.');
    try {
      return (await decrypt(key, deserializeEncryptedEnvelope(record.envelope))) as T;
    } catch (error) {
      if (error instanceof BrowserVaultIntegrityError) throw error;
      throw new BrowserVaultIntegrityError();
    }
  }

  async rawRecords(): Promise<VaultRecord[]> {
    return this.storage.listRecords();
  }
  close(): void {
    this.lock();
    this.storage.close();
  }
  private requireKey(): CryptoKey {
    if (!this.workspaceKey) throw new BrowserVaultLockedError();
    return this.workspaceKey;
  }
}

export const indexedDbStorage: BrowserVaultStorageFactory = async (name) => {
  if (typeof indexedDB === 'undefined')
    throw new BrowserVaultStorageError('IndexedDB is unavailable in this browser context.');
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`themis-vault:${name}`, VAULT_SCHEMA_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) throw new BrowserVaultStorageError('IndexedDB schema migration has no transaction.');
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('records'))
        database.createObjectStore('records', { keyPath: 'envelopeId' });
      if (event instanceof IDBVersionChangeEvent && event.oldVersion === LEGACY_VAULT_SCHEMA_VERSION) {
        const metaStore = transaction.objectStore('meta');
        const metaRequest = metaStore.get('vault');
        metaRequest.onsuccess = () => {
          const meta = metaRequest.result as VaultMeta | undefined;
          if (meta?.schemaVersion === LEGACY_VAULT_SCHEMA_VERSION) {
            metaStore.put({ ...meta, schemaVersion: VAULT_SCHEMA_VERSION });
          }
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new BrowserVaultStorageError('IndexedDB could not be opened.', request.error));
  });
  const request = <T>(
    store: 'meta' | 'records',
    mode: IDBTransactionMode,
    action: (objectStore: IDBObjectStore) => IDBRequest<T>,
  ) =>
    new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(store, mode);
      const result = action(transaction.objectStore(store));
      let value: T;
      let requestError: unknown;
      result.onsuccess = () => {
        value = result.result;
      };
      result.onerror = () => {
        requestError = result.error;
      };
      transaction.oncomplete = () => {
        if (requestError) {
          reject(new BrowserVaultStorageError('IndexedDB transaction failed.', requestError));
          return;
        }
        resolve(value);
      };
      transaction.onerror = () =>
        reject(new BrowserVaultStorageError('IndexedDB transaction failed.', transaction.error ?? requestError));
      transaction.onabort = () =>
        reject(
          new BrowserVaultStorageError('IndexedDB transaction was rolled back.', transaction.error ?? requestError),
        );
    });
  return {
    getMeta: () => request<VaultMeta | undefined>('meta', 'readonly', (store) => store.get('vault')),
    putMeta: (meta: VaultMeta) => request('meta', 'readwrite', (store) => store.put(meta)).then(() => undefined),
    getRecord: (id: string) => request<VaultRecord | undefined>('records', 'readonly', (store) => store.get(id)),
    putRecord: (record: VaultRecord) =>
      request('records', 'readwrite', (store) => store.put(record)).then(() => undefined),
    listRecords: () => request<VaultRecord[]>('records', 'readonly', (store) => store.getAll()),
    close: () => database.close(),
  };
};
