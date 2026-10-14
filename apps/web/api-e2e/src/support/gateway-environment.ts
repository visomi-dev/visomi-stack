/** Local developer settings are not authorization to exercise durable infrastructure. */
export function gatewayStorageEnvironment(environment: NodeJS.ProcessEnv): {
  DATABASE_DRIVER: 'memory' | 'pg';
  OPAQUE_SYNC_STORAGE: 'memory' | 'durable';
} {
  const mode = environment['API_E2E_STORAGE_MODE'];

  if (mode === undefined || mode === 'memory') {
    return { DATABASE_DRIVER: 'memory', OPAQUE_SYNC_STORAGE: 'memory' };
  }
  if (
    mode !== 'durable' ||
    environment['DATABASE_DRIVER'] !== 'pg' ||
    environment['OPAQUE_SYNC_STORAGE'] !== 'durable'
  ) {
    throw new Error('API E2E durable mode requires an explicit PostgreSQL and durable-storage configuration.');
  }

  return { DATABASE_DRIVER: 'pg', OPAQUE_SYNC_STORAGE: 'durable' };
}
