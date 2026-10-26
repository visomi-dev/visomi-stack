import { serveTestApplication } from '@visomi-stack/dev-testing/playwright';

void serveTestApplication('gateway').catch(() => {
  process.stderr.write('isolated_http_test_startup_failed\n');
  process.exitCode = 1;
});
