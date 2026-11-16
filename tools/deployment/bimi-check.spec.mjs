import assert from 'node:assert/strict';
import test from 'node:test';

import { checkBimi } from './bimi-check.mjs';

const origin = 'https://app.example.test';
const logo = `${origin}/static/brand/bimi/v1/visomi.svg`;

test('monitoring-only DMARC and a missing certificate cannot pass readiness', async () => {
  const status = await checkBimi('example.test', origin, {
    txt: async (name) => [[name.startsWith('_dmarc') ? 'v=DMARC1; p=none; pct=100;' : `v=BIMI1; l=${logo}; a=;`]],
    request: async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
  });

  assert.deepEqual(status, {
    dmarcEnforced: false,
    bimiRecordMatches: true,
    logoAvailable: true,
    certificateAvailable: false,
    certificateCurrent: false,
  });
});

test('partial enforcement, multiple records, redirects and invalid certificates fail closed', async () => {
  for (const policy of [
    [['v=DMARC1; p=none; p=reject; pct=100;']],
    [['v=DMARC1; p=reject; pct=50;']],
    [['v=DMARC1; p=reject;'], ['v=DMARC1; p=quarantine;']],
  ]) {
    const status = await checkBimi('example.test', origin, {
      txt: async (name) =>
        name.startsWith('_dmarc') ? policy : [[`v=BIMI1; l=${logo}; a=${origin}/certificate.pem;`]],
      request: async (_url, options) => {
        assert.equal(options.redirect, 'error');

        return new Response('not a certificate', { status: 404 });
      },
    });

    assert.equal(status.dmarcEnforced, false);
    assert.equal(status.logoAvailable, false);
    assert.equal(status.certificateAvailable, false);
  }
});

test('DNS and network outages return bounded readiness fields without raw exceptions', async () => {
  const status = await checkBimi('example.test', origin, {
    txt: async () => {
      throw new Error('SYNTHETIC_PRIVATE_DNS_DETAIL');
    },
    request: async () => {
      throw new Error('SYNTHETIC_PRIVATE_NETWORK_DETAIL');
    },
  });

  assert.ok(Object.values(status).every((value) => value === false));
  assert.doesNotMatch(JSON.stringify(status), /SYNTHETIC_PRIVATE/);
});

test('the readiness command requires a sender domain and canonical HTTPS origin', async () => {
  await assert.rejects(checkBimi('not a domain', origin), /bimi_configuration_invalid/);

  await assert.rejects(checkBimi('example.test', 'http://app.example.test'), /bimi_configuration_invalid/);

  await assert.rejects(checkBimi('example.test', `${origin}/unexpected`), /bimi_configuration_invalid/);
});
