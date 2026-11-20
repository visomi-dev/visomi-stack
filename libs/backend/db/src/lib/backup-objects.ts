/** Server-owned bytes transport. The persistence adapter owns scope, integrity and publication. */
export type BackupObjects = {
  put(key: string, body: string): Promise<void>;
  get(key: string, bytes: number): Promise<string>;
  delete(key: string): Promise<void>;
  close(): void;
};
