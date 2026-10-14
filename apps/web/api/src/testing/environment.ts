// Unit suites must not inherit a developer's PostgreSQL connection or depend on CI services.
// Durable vault and Redis security suites retain their explicit integration opt-ins.
if (!process.env['VAULT_UNLOCK_TEST_DATABASE_URL'] && process.env['AUTH_REDIS_INTEGRATION'] !== '1') {
  process.env['DATABASE_DRIVER'] = 'memory';
}
