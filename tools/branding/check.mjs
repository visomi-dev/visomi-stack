import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import brand from '../../assets/brand/public.json' with { type: 'json' };

export function checkPng(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.subarray(12, 16).toString(), 'IHDR');
  assert.equal(bytes.readUInt32BE(16), 412);
  assert.equal(bytes.readUInt32BE(20), 104);
  assert.equal(bytes[24], 8);
  assert.ok(bytes.length < 32768, 'Email logo must stay below 32 KiB');
}

// Local policy checks supplement, rather than replace, the issuer's Tiny PS validation.
export function checkBimiSvg(svg) {
  assert.ok(Buffer.byteLength(svg) <= 32768);
  assert.match(svg, /<svg\b[^>]*\bversion="1\.2"/);
  assert.match(svg, /<svg\b[^>]*\bbaseProfile="tiny-ps"/);
  assert.match(svg, /<svg\b[^>]*\bwidth="512"/);
  assert.match(svg, /<svg\b[^>]*\bheight="512"/);
  assert.match(svg, /<svg\b[^>]*\bviewBox="0 0 512 512"/);
  assert.match(svg, /<title>Visomi<\/title>/);
  assert.match(svg, /<desc>[^<]+<\/desc>/);
  assert.match(svg, /<rect width="512" height="512" fill="#ffffff"\s*\/>/);
  assert.match(svg, /<path\b/);
  assert.doesNotMatch(svg, /<!|\b(?:href|style|on\w+)\s*=|url\s*\(|<svg\b[^>]*\s[xy]=/i);
  for (const tag of svg.matchAll(/<\/?([\w:-]+)/g)) {
    assert.ok(['svg', 'title', 'desc', 'rect', 'g', 'path'].includes(tag[1]), 'Unexpected BIMI element');
  }
}

export function checkPublicCertificate(pem) {
  assert.ok(Buffer.byteLength(pem) < 1_000_000);
  const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];

  assert.ok(certificates.length > 0);
  assert.equal(pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim(), '');
  for (const value of certificates) {
    new X509Certificate(value);
  }
}

export async function checkRetention(previous, current, readPrevious, readCurrent) {
  for (const file of previous.files) {
    assert.ok(current.files.includes(file), 'Published assets must remain in the allowlist');
    const before = await readPrevious(file);
    const after = await readCurrent(file);

    assert.ok(before.equals(after), 'Published assets cannot change at an immutable URL; add a new version');
  }
}

export async function checkBrand() {
  assert.equal(new Set(brand.files).size, brand.files.length);
  assert.ok(brand.files.includes(brand.emailLogo));
  assert.ok(brand.files.includes(brand.bimiLogo));
  for (const file of brand.files) {
    assert.match(file, /^(?:email\/v[1-9]\d*\/[a-z0-9-]+\.png|bimi\/v[1-9]\d*\/[a-z0-9-]+\.(?:svg|pem))$/);
    const bytes = await readFile(new URL(`../../assets/brand/${file}`, import.meta.url));

    if (file.endsWith('.png')) {
      checkPng(bytes);
    } else if (file.endsWith('.svg')) {
      checkBimiSvg(bytes.toString('utf8'));
    } else {
      checkPublicCertificate(bytes.toString('utf8'));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkBrand();

  const base = process.env.NX_BASE;

  if (base) {
    assert.match(base, /^[a-f0-9]{7,40}$/i);
    const options = { cwd: new URL('../../', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] };

    execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], options);

    if (execFileSync('git', ['ls-tree', base, '--', 'assets/brand/public.json'], options).length) {
      const previous = JSON.parse(execFileSync('git', ['show', `${base}:assets/brand/public.json`], options));

      await checkRetention(
        previous,
        brand,
        (file) => execFileSync('git', ['show', `${base}:assets/brand/${file}`], options),
        (file) => readFile(new URL(`../../assets/brand/${file}`, import.meta.url)),
      );
    }
  }

  console.log('Versioned public email and BIMI assets verified.');
}
