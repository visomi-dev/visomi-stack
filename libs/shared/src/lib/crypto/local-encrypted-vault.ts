import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
  decryptAead,
  deriveWorkspaceKey,
  encryptAead,
  unwrapWorkspaceKey,
  wrapWorkspaceKey,
} from './crypto-proof-harness';
import {
  deserializeEncryptedEnvelope,
  parseEncryptedEnvelope,
  serializeEncryptedEnvelope,
  type EncryptedEnvelope,
} from './encrypted-envelope';

const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const VAULT_SCHEMA_VERSION = 1;

function envelopeAad(recordType: string, associatedData: Record<string, string>): string {
  return `themis.encrypted-envelope:v1:${recordType}:${JSON.stringify(associatedData)}`;
}

export class VaultLockedError extends Error {
  constructor() {
    super('The local vault is locked.');
    this.name = 'VaultLockedError';
  }
}

export class VaultRecoveryBlockedError extends Error {
  constructor() {
    super('Vault recovery is blocked: no recovery key or unsafe fallback is configured.');
    this.name = 'VaultRecoveryBlockedError';
  }
}

export class VaultIntegrityError extends Error {
  constructor() {
    super('The local vault record failed integrity verification.');
    this.name = 'VaultIntegrityError';
  }
}

type VaultOptions = {
  workspaceId: string;
  vmk: Uint8Array;
};

type VaultRow = {
  envelope: string;
};

/**
 * A deliberately small local-only proof. SQLite stores only the wrapped
 * workspace key and serialized encrypted envelopes; VMK and plaintext never
 * become database columns. Password KDF, recovery keys, and cloud sync remain
 * explicit follow-up decisions.
 */
export class LocalEncryptedVault {
  private workspaceKey: Buffer | undefined;

  private constructor(private readonly database: DatabaseSync) {}

  static initialize(path: string, options: VaultOptions): LocalEncryptedVault {
    const database = new DatabaseSync(path);
    const vault = new LocalEncryptedVault(database);

    vault.createSchema();

    const existing = database.prepare('SELECT workspace_id FROM vault_meta LIMIT 1').get() as
      | { workspace_id: string }
      | undefined;

    if (existing) {
      database.close();
      throw new Error('Vault is already initialized.');
    }

    const salt = randomBytes(SALT_BYTES);
    const nonce = randomBytes(NONCE_BYTES);
    const workspaceKey = deriveWorkspaceKey(options.vmk, options.workspaceId, salt);
    const wrapped = wrapWorkspaceKey(options.vmk, workspaceKey, nonce, options.workspaceId);

    database
      .prepare('INSERT INTO vault_meta (schema_version, workspace_id, salt, wrapped_workspace_key) VALUES (?, ?, ?, ?)')
      .run(VAULT_SCHEMA_VERSION, options.workspaceId, salt.toString('base64url'), JSON.stringify(wrapped));
    vault.workspaceKey = workspaceKey;

    return vault;
  }

  static open(path: string, vmk: Uint8Array): LocalEncryptedVault {
    const database = new DatabaseSync(path);
    const vault = new LocalEncryptedVault(database);

    vault.createSchema();
    const metadata = database.prepare('SELECT * FROM vault_meta LIMIT 1').get() as
      | { schema_version: number; workspace_id: string; salt: string; wrapped_workspace_key: string }
      | undefined;

    if (!metadata || metadata.schema_version !== VAULT_SCHEMA_VERSION) {
      database.close();
      throw new Error('Unsupported local vault version.');
    }

    try {
      vault.workspaceKey = unwrapWorkspaceKey(
        vmk,
        JSON.parse(metadata.wrapped_workspace_key) as ReturnType<typeof wrapWorkspaceKey>,
        metadata.workspace_id,
      );
    } catch {
      database.close();
      throw new Error('Vault could not be unlocked with the supplied key material.');
    }

    return vault;
  }

  lock(): void {
    this.workspaceKey?.fill(0);
    this.workspaceKey = undefined;
  }

  unlock(vmk: Uint8Array): void {
    const metadata = this.database.prepare('SELECT * FROM vault_meta LIMIT 1').get() as {
      schema_version: number;
      workspace_id: string;
      wrapped_workspace_key: string;
    };

    if (metadata.schema_version !== VAULT_SCHEMA_VERSION) {
      throw new Error('Unsupported local vault version.');
    }

    try {
      this.workspaceKey = unwrapWorkspaceKey(
        vmk,
        JSON.parse(metadata.wrapped_workspace_key) as ReturnType<typeof wrapWorkspaceKey>,
        metadata.workspace_id,
      );
    } catch {
      throw new Error('Vault could not be unlocked with the supplied key material.');
    }
  }

  recover(): never {
    throw new VaultRecoveryBlockedError();
  }

  write(recordType: string, value: unknown): string {
    const key = this.requireKey();
    const metadata = this.database.prepare('SELECT workspace_id FROM vault_meta LIMIT 1').get() as {
      workspace_id: string;
    };
    const envelopeId = randomBytes(16).toString('hex');
    const nonce = randomBytes(NONCE_BYTES);
    const associatedData = { purpose: recordType, workspace: metadata.workspace_id };
    const encrypted = encryptAead(
      key,
      nonce,
      Buffer.from(JSON.stringify(value), 'utf8'),
      envelopeAad(recordType, associatedData),
    );
    const envelope: EncryptedEnvelope = parseEncryptedEnvelope({
      format: 'themis.encrypted-envelope',
      version: 1,
      kind: 'local-record',
      envelopeId,
      workspaceId: metadata.workspace_id,
      recordType,
      revision: 1,
      createdAt: new Date().toISOString(),
      associatedData,
      metadata: { contentType: 'application/json' },
      nonce: nonce.toString('base64url'),
      ciphertext: Buffer.from(encrypted.ciphertext, 'hex').toString('base64url'),
      authTag: Buffer.from(encrypted.authTag, 'hex').toString('base64url'),
    });

    this.database.prepare('INSERT INTO vault_nonces (nonce) VALUES (?)').run(envelope.nonce);
    this.database
      .prepare('INSERT INTO vault_records (envelope_id, envelope) VALUES (?, ?)')
      .run(envelopeId, serializeEncryptedEnvelope(envelope));

    return envelopeId;
  }

  read<T>(envelopeId: string): T {
    const key = this.requireKey();
    const row = this.database.prepare('SELECT envelope FROM vault_records WHERE envelope_id = ?').get(envelopeId) as
      | VaultRow
      | undefined;

    if (!row) {
      throw new Error('Vault record was not found.');
    }
    try {
      const envelope = deserializeEncryptedEnvelope(row.envelope);
      const nonce = Buffer.from(envelope.nonce, 'base64url');

      if (nonce.length !== NONCE_BYTES) throw new Error('Invalid vault nonce length.');
      const plaintext = decryptAead(
        key,
        nonce,
        {
          ciphertext: Buffer.from(envelope.ciphertext, 'base64url').toString('hex'),
          authTag: Buffer.from(envelope.authTag, 'base64url').toString('hex'),
        },
        envelopeAad(envelope.recordType, envelope.associatedData),
      );

      return JSON.parse(plaintext.toString('utf8')) as T;
    } catch {
      throw new VaultIntegrityError();
    }
  }

  rawRecords(): string[] {
    return (this.database.prepare('SELECT envelope FROM vault_records ORDER BY envelope_id').all() as VaultRow[]).map(
      ({ envelope }) => envelope,
    );
  }

  close(): void {
    this.lock();
    this.database.close();
  }

  private createSchema(): void {
    this.database.exec(
      'CREATE TABLE IF NOT EXISTS vault_meta (schema_version INTEGER NOT NULL, workspace_id TEXT NOT NULL, salt TEXT NOT NULL, wrapped_workspace_key TEXT NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS vault_records (envelope_id TEXT PRIMARY KEY NOT NULL, envelope TEXT NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS vault_nonces (nonce TEXT PRIMARY KEY NOT NULL);',
    );
  }

  private requireKey(): Buffer {
    if (!this.workspaceKey) {
      throw new VaultLockedError();
    }

    return this.workspaceKey;
  }
}
