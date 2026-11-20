import { z } from 'zod';
import {
  dataEnvelopeSchema,
  wrappedKeySchema,
  VaultError,
  keyDomainId,
  type KeyDomain,
  type DataEnvelope,
  type VaultStorage,
  type WrappedKey,
} from '@visomi-stack/shared-db';

import { isLocalPasskeyOf, type LocalPasskeyStorage } from '../vault/local-passkey';

import { VaultDatabase, openDatabase, storageError } from './database';

const storedKeySchema = z.strictObject({
  id: z.string(),
  envelope: wrappedKeySchema,
  used: z.number().int().min(0).max(1_048_576),
});
const storedUnitSchema = z.strictObject({ id: z.string(), envelope: dataEnvelopeSchema });
const localPasskeySchema = z.strictObject({ id: z.string(), pin: wrappedKeySchema, passkey: wrappedKeySchema });

type StoredKey = z.infer<typeof storedKeySchema>;
type StoredUnit = z.infer<typeof storedUnitSchema>;
type LocalPasskey = z.infer<typeof localPasskeySchema>;

// Data units use JSON tuple IDs. The reserved ID keeps the v1 key catalog and its readers intact.
const localPasskeyId = (id: string) => `local-passkey:${id}`;

/** Resolves only after transaction commit; request success alone is not durability. */
export class IndexedDbVaultStorage implements VaultStorage {
  readonly localPasskeys?: LocalPasskeyStorage;

  private constructor(
    private readonly database: VaultDatabase,
    enableLocalPasskeys: boolean,
  ) {
    if (enableLocalPasskeys) {
      this.localPasskeys = {
        get: (id) => this.getLocalPasskey(id),
        add: (pin, passkey, signal) => this.addLocalPasskey(pin, passkey, signal),
      };
    }
  }

  static async open(
    factory: IDBFactory | undefined,
    name: string,
    options?: { localPasskeys: true },
  ): Promise<IndexedDbVaultStorage> {
    if (!factory) {
      throw new VaultError('unavailable');
    }

    const database = await openDatabase(new VaultDatabase(name, factory), factory, ['keys', 'units'], 'id');

    return new IndexedDbVaultStorage(database, options?.localPasskeys === true);
  }

  async getKey(id: string): Promise<WrappedKey | undefined> {
    const value = await this.read<StoredKey>('keys', id);

    if (!value) {
      return undefined;
    }

    const result = storedKeySchema.safeParse(value);

    if (!result.success || result.data.id !== id) {
      throw new VaultError('corrupt');
    }

    return result.data.envelope;
  }

  /** Active binding selection cannot follow cloud metadata back to a locally retained historical wrapper. */
  async getCurrentKey(ownerId: string, key: KeyDomain): Promise<WrappedKey | undefined> {
    const prefix = keyDomainId(ownerId, { ...key, generation: 1 }).slice(0, -2);

    try {
      const value = await this.database.transaction('r', this.database.keys, async () => {
        const rows = await this.database.keys.where(':id').startsWith(prefix).toArray();
        let value: WrappedKey | undefined;

        for (const row of rows) {
          if (typeof row.id !== 'string' || !row.id.startsWith(prefix)) {
            continue;
          }

          const parsed = storedKeySchema.safeParse(row);

          if (
            !parsed.success ||
            keyDomainId(parsed.data.envelope.context.ownerId, parsed.data.envelope.context.key) !== row.id ||
            parsed.data.envelope.context.key.generation > key.generation
          ) {
            throw new VaultError('corrupt');
          }

          if (parsed.data.envelope.context.key.generation === key.generation) {
            value = parsed.data.envelope;
          }
        }

        return value;
      });

      return value;
    } catch (error) {
      throw storageError(error);
    }
  }

  /** Local discovery only. The wrapper is authenticated on unlock; sync retains its independent generation pin. */
  async getLatestKey(ownerId: string, key: Omit<KeyDomain, 'generation'>): Promise<WrappedKey | undefined> {
    const prefix = keyDomainId(ownerId, { ...key, generation: 1 }).slice(0, -2);

    try {
      const result = await this.database.transaction('r', this.database.keys, async () => {
        const rows = await this.database.keys.where(':id').startsWith(prefix).toArray();
        let latest: WrappedKey | undefined;

        for (const row of rows) {
          const parsed = storedKeySchema.safeParse(row);

          if (
            !parsed.success ||
            keyDomainId(ownerId, parsed.data.envelope.context.key) !== row.id ||
            parsed.data.envelope.context.ownerId !== ownerId
          ) {
            throw new VaultError('corrupt');
          }

          if (!latest || parsed.data.envelope.context.key.generation > latest.context.key.generation) {
            latest = parsed.data.envelope;
          }
        }

        return latest;
      });

      return result;
    } catch (error) {
      throw storageError(error);
    }
  }

  /** Metadata discovery only; each returned wrapper must still authenticate before use. */
  async latestBindings(ownerId: string): Promise<WrappedKey['context'][]> {
    try {
      const bindings = await this.database.transaction('r', this.database.keys, async () => {
        const latest = new Map<string, WrappedKey>();

        const rows = await this.database.keys.toArray();

        for (const row of rows) {
          const parsed = storedKeySchema.safeParse(row);

          if (
            !parsed.success ||
            parsed.data.envelope.context.ownerId !== ownerId ||
            keyDomainId(ownerId, parsed.data.envelope.context.key) !== row.id
          ) {
            throw new VaultError('corrupt');
          }

          const envelope = parsed.data.envelope;
          const id = keyDomainId(ownerId, { ...envelope.context.key, generation: 1 });
          const previous = latest.get(id);

          if (!previous || previous.context.key.generation < envelope.context.key.generation) {
            latest.set(id, envelope);
          }
        }

        return [...latest.values()].map(({ context }) => context);
      });

      return bindings;
    } catch (error) {
      throw storageError(error);
    }
  }

  async putKey(id: string, envelope: WrappedKey, exhausted = false): Promise<void> {
    const result = wrappedKeySchema.safeParse(envelope);

    if (!result.success) {
      throw new VaultError('corrupt');
    }

    await this.change<StoredKey>('keys', id, (current) => {
      if (current) {
        throw new VaultError('revision-conflict');
      }

      return { id, envelope: result.data, used: exhausted ? 1_048_576 : 0 };
    });
  }

  async reserveEncryption(id: string, limit: number): Promise<void> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_048_576) {
      throw new VaultError('quota');
    }

    await this.change<StoredKey>('keys', id, (value) => {
      const parsed = storedKeySchema.safeParse(value);

      if (!parsed.success || parsed.data.id !== id) {
        throw new VaultError('corrupt');
      }

      if (parsed.data.used >= limit) {
        throw new VaultError('quota');
      }

      return { id, envelope: parsed.data.envelope, used: parsed.data.used + 1 };
    });
  }

  async getUnit(id: string): Promise<DataEnvelope | undefined> {
    const value = await this.read<StoredUnit>('units', id);

    if (!value) {
      return undefined;
    }

    const result = storedUnitSchema.safeParse(value);

    if (!result.success || result.data.id !== id) {
      throw new VaultError('corrupt');
    }

    return result.data.envelope;
  }

  async putUnit(id: string, expectedRevision: number, envelope: DataEnvelope): Promise<void> {
    const parsed = dataEnvelopeSchema.safeParse(envelope);

    if (
      !parsed.success ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      parsed.data.context.revision !== expectedRevision + 1
    ) {
      throw new VaultError('corrupt');
    }

    await this.change<StoredUnit>('units', id, (current) => {
      if (current && (!storedUnitSchema.safeParse(current).success || current.id !== id)) {
        throw new VaultError('corrupt');
      }

      if (
        (current?.envelope.context.revision ?? 0) !== expectedRevision ||
        (current && current.envelope.context.key.generation > parsed.data.context.key.generation)
      ) {
        throw new VaultError('revision-conflict');
      }

      return { id, envelope: parsed.data };
    });
  }

  async deleteKey(id: string): Promise<void> {
    if (this.localPasskeys) {
      try {
        await this.database.transaction('rw', this.database.keys, this.database.units, async () => {
          await this.database.keys.delete(id);

          await this.database.units.delete(localPasskeyId(id));
        });

        return;
      } catch (error) {
        throw storageError(error);
      }
    }

    await this.change<StoredKey>('keys', id, () => undefined);
  }

  async restore(
    key: { id: string; envelope: WrappedKey },
    units: readonly { id: string; envelope: DataEnvelope }[],
  ): Promise<void> {
    const parsedKey = storedKeySchema.safeParse({ ...key, used: 1_048_576 });
    const parsedUnits = z.array(storedUnitSchema).max(100).safeParse(units);

    if (!parsedKey.success || !parsedUnits.success || new Set(units.map((unit) => unit.id)).size !== units.length) {
      throw new VaultError('corrupt');
    }

    try {
      await this.database.transaction('rw', this.database.keys, this.database.units, async () => {
        const existing = await this.database.keys.get(key.id);

        if (existing !== undefined) {
          throw new VaultError('revision-conflict');
        }

        for (const unit of parsedUnits.data) {
          const stored = await this.database.units.get(unit.id);

          if (stored !== undefined) {
            throw new VaultError('revision-conflict');
          }

          await this.database.units.put(unit);
        }

        await this.database.keys.put(parsedKey.data);
      });
    } catch (error) {
      throw storageError(error);
    }
  }

  close(): void {
    this.database.close();
  }

  private async getLocalPasskey(id: string): Promise<WrappedKey | undefined> {
    const entries = this.database.table<LocalPasskey, string>('units');
    const alternateId = localPasskeyId(id);

    try {
      const found = await this.database.transaction('r', this.database.keys, entries, async () => {
        const current = await this.database.keys.get(id);
        const entry = await entries.get(alternateId);
        const key = storedKeySchema.safeParse(current);
        const alternate = localPasskeySchema.safeParse(entry);

        if (
          !key.success ||
          !alternate.success ||
          key.data.id !== id ||
          alternate.data.id !== alternateId ||
          keyDomainId(key.data.envelope.context.ownerId, key.data.envelope.context.key) !== id ||
          JSON.stringify(key.data.envelope) !== JSON.stringify(alternate.data.pin) ||
          !isLocalPasskeyOf(key.data.envelope.context, alternate.data.passkey.context)
        ) {
          return undefined;
        }

        return alternate.data.passkey;
      });

      return found;
    } catch (error) {
      throw storageError(error);
    }
  }

  private async addLocalPasskey(pin: WrappedKey, passkey: WrappedKey, signal: AbortSignal): Promise<void> {
    const primary = wrappedKeySchema.safeParse(pin);
    const alternate = wrappedKeySchema.safeParse(passkey);

    if (!primary.success || !alternate.success || !isLocalPasskeyOf(primary.data.context, alternate.data.context)) {
      throw new VaultError('corrupt');
    }

    const id = keyDomainId(primary.data.context.ownerId, primary.data.context.key);
    const alternateId = localPasskeyId(id);
    const entries = this.database.table<LocalPasskey, string>('units');
    let abort: (() => void) | undefined;

    try {
      signal.throwIfAborted();

      await this.database.transaction('rw', this.database.keys, entries, async (transaction) => {
        signal.throwIfAborted();
        abort = () => {
          try {
            transaction.idbtrans.abort();
          } catch (error) {
            // A transaction that already committed is a completed enrollment.
            if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
              throw error;
            }
          }
        };
        signal.addEventListener('abort', abort, { once: true });

        const current = await this.database.keys.get(id);
        const key = storedKeySchema.safeParse(current);

        if (!key.success || key.data.id !== id || JSON.stringify(key.data.envelope) !== JSON.stringify(primary.data)) {
          throw new VaultError('revision-conflict');
        }

        const existing = await entries.get(alternateId);

        if (existing !== undefined) {
          throw new VaultError('revision-conflict');
        }

        signal.throwIfAborted();

        await entries.add({ id: alternateId, pin: primary.data, passkey: alternate.data });

        signal.throwIfAborted();
      });
    } catch (error) {
      throw signal.aborted ? new VaultError('cancelled') : storageError(error);
    } finally {
      if (abort) {
        signal.removeEventListener('abort', abort);
      }
    }
  }

  private async read<T>(store: string, id: string): Promise<T | undefined> {
    try {
      const value = await this.database.table<T, string>(store).get(id);

      return value;
    } catch (error) {
      throw storageError(error);
    }
  }

  private async change<T>(store: string, id: string, update: (current: T | undefined) => T | undefined): Promise<void> {
    const table = this.database.table<T, string>(store);

    try {
      await this.database.transaction('rw', table, async () => {
        const current = await table.get(id);
        const next = update(current);

        if (next === undefined) {
          await table.delete(id);
        } else {
          await table.put(next);
        }
      });
    } catch (error) {
      throw storageError(error);
    }
  }
}
