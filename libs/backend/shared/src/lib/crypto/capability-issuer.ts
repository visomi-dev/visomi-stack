import { createPublicKey, type KeyObject } from 'node:crypto';

export type IssuerKeyRecord = Readonly<{
  issuer: string;
  keyId: string;
  publicKey: string;
  status: 'active' | 'retired' | 'revoked';
  validFrom: string;
  validUntil?: string;
}>;

export type IssuerKeyPersistence = {
  load: () => readonly IssuerKeyRecord[];
  save: (keys: readonly IssuerKeyRecord[]) => void;
};

/** Durable public-key registry. Private keys remain in the local agent's custody. */
export class CapabilityIssuerKeyRegistry {
  private readonly keys: IssuerKeyRecord[];

  public constructor(private readonly persistence: IssuerKeyPersistence) {
    this.keys = [...persistence.load()];
  }

  public register(record: IssuerKeyRecord): void {
    if (this.keys.some((key) => key.issuer === record.issuer && key.keyId === record.keyId)) {
      throw new Error('Issuer key already exists.');
    }

    createPublicKey({ key: Buffer.from(record.publicKey, 'base64url'), format: 'der', type: 'spki' });
    this.keys.push(record);
    this.persist();
  }

  public rotate(issuer: string, retiredKeyId: string, replacement: IssuerKeyRecord): void {
    const current = this.keys.find((key) => key.issuer === issuer && key.keyId === retiredKeyId);

    if (!current || current.status === 'revoked') throw new Error('Issuer key cannot be rotated.');

    this.register(replacement);
    this.update(issuer, retiredKeyId, 'retired');
  }

  public revoke(issuer: string, keyId: string): void {
    this.update(issuer, keyId, 'revoked');
  }

  public resolve(issuer: string, keyId: string, now = new Date()): KeyObject | undefined {
    const record = this.keys.find((key) => key.issuer === issuer && key.keyId === keyId);

    if (!record || record.status === 'revoked' || Date.parse(record.validFrom) > now.getTime()) return undefined;
    if (record.validUntil && Date.parse(record.validUntil) <= now.getTime()) return undefined;

    return createPublicKey({ key: Buffer.from(record.publicKey, 'base64url'), format: 'der', type: 'spki' });
  }

  public snapshot(): readonly IssuerKeyRecord[] {
    return this.keys;
  }

  private update(issuer: string, keyId: string, status: IssuerKeyRecord['status']): void {
    const index = this.keys.findIndex((key) => key.issuer === issuer && key.keyId === keyId);

    if (index < 0) throw new Error('Issuer key was not found.');
    this.keys[index] = { ...this.keys[index], status };
    this.persist();
  }

  private persist(): void {
    this.persistence.save(this.keys);
  }
}
