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

import { VaultDatabase, openDatabase, storageError } from './database';

const storedKeySchema = z.strictObject({
  id: z.string(),
  envelope: wrappedKeySchema,
  used: z.number().int().min(0).max(1_048_576),
});
const storedUnitSchema = z.strictObject({ id: z.string(), envelope: dataEnvelopeSchema });

type StoredKey = z.infer<typeof storedKeySchema>;
type StoredUnit = z.infer<typeof storedUnitSchema>;

/** Resolves only after transaction commit; request success alone is not durability. */
export class IndexedDbVaultStorage implements VaultStorage {
  private constructor(private readonly database: VaultDatabase) {}

  static async open(factory: IDBFactory | undefined, name: string): Promise<IndexedDbVaultStorage> {
    if (!factory) {
      throw new VaultError('unavailable');
    }

    const database = await openDatabase(new VaultDatabase(name, factory), factory, ['keys', 'units'], 'id');

    return new IndexedDbVaultStorage(database);
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
