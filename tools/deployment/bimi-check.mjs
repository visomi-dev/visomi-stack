import { X509Certificate } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';

import brand from '../../assets/brand/public.json' with { type: 'json' };

function tags(record) {
  const values = {};

  for (const field of record
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const match = field.match(/^([a-z][a-z0-9]*)=(.*)$/i);

    if (!match || Object.hasOwn(values, match[1].toLowerCase())) {
      return {};
    }

    values[match[1].toLowerCase()] = match[2].trim();
  }

  return values;
}

export async function checkBimi(domain, origin, { txt = resolveTxt, request = fetch } = {}) {
  const base = new URL(origin);

  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain) ||
    base.origin !== origin ||
    base.protocol !== 'https:'
  ) {
    throw new Error('bimi_configuration_invalid');
  }

  const records = async (name, prefix) => {
    try {
      const answers = await txt(name);
      const values = answers.map((chunks) => chunks.join('').trim()).filter((value) => value.startsWith(prefix));

      return values.length === 1 ? tags(values[0]) : {};
    } catch {
      return {};
    }
  };
  const [dmarc, bimi] = await Promise.all([
    records(`_dmarc.${domain}`, 'v=DMARC1;'),
    records(`default._bimi.${domain}`, 'v=BIMI1;'),
  ]);
  const logo = new URL(`/static/brand/${brand.bimiLogo}`, base).href;
  const status = {
    dmarcEnforced: ['quarantine', 'reject'].includes(dmarc.p) && (dmarc.pct ?? '100') === '100',
    bimiRecordMatches: bimi.l === logo,
    logoAvailable: false,
    certificateAvailable: false,
    certificateCurrent: false,
  };

  try {
    const response = await request(logo, { redirect: 'error', signal: AbortSignal.timeout(10000) });

    status.logoAvailable = response.ok && /image\/svg\+xml/i.test(response.headers.get('content-type') ?? '');

    await response.arrayBuffer();
  } catch {
    // Only bounded readiness states are reported; response bodies and raw errors stay private.
  }

  try {
    const certificateUrl = new URL(bimi.a);

    if (
      status.bimiRecordMatches &&
      certificateUrl.protocol === 'https:' &&
      !certificateUrl.username &&
      !certificateUrl.password
    ) {
      const response = await request(certificateUrl, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      const pem = await response.text();

      if (response.ok && pem.length < 1_000_000 && !pem.includes('PRIVATE KEY')) {
        const certificate = new X509Certificate(pem);

        status.certificateAvailable = true;
        status.certificateCurrent =
          Date.parse(certificate.validFrom) <= Date.now() && Date.parse(certificate.validTo) > Date.now();
      }
    }
  } catch {
    // A missing, inaccessible or malformed certificate leaves activation pending.
  }

  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const status = await checkBimi(process.argv[2] ?? '', process.argv[3] ?? '');

    console.log(JSON.stringify(status, null, 2));
    console.log('Readiness only: issuer trust, logo binding and mailbox acceptance require separate verification.');
    process.exitCode = Object.values(status).every(Boolean) ? 0 : 1;
  } catch {
    console.error('Usage: bimi-check.mjs <sender-domain> <https-public-origin>');
    process.exitCode = 2;
  }
}
