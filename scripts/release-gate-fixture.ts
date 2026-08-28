import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { createReleaseManifest, createSignedKeyCatalogue, type KeyCatalogueEntry } from './release-verification.ts';

const [artifactPath, outputDirectory] = process.argv.slice(2);

if (!artifactPath || !outputDirectory) {
  throw new Error('Usage: release-gate-fixture <generated-artifact> <output-directory>');
}

const artifact = await readFile(artifactPath);
const releaseKeys = generateKeyPairSync('ed25519');
const catalogueKeys = generateKeyPairSync('ed25519');
const entry: KeyCatalogueEntry = {
  keyId: 'ci-release-key',
  publicKey: releaseKeys.publicKey,
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2099-01-01T00:00:00.000Z',
  revoked: false,
};
const manifest = createReleaseManifest(basename(artifactPath), artifact, releaseKeys.privateKey, entry.keyId);
const catalogue = createSignedKeyCatalogue([entry], catalogueKeys.privateKey);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(join(outputDirectory, 'themis.release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(join(outputDirectory, 'themis.key-catalogue.json'), `${JSON.stringify(catalogue, null, 2)}\n`),
  writeFile(
    join(outputDirectory, 'catalogue-key.pem'),
    catalogueKeys.publicKey.export({ type: 'spki', format: 'pem' }),
  ),
  writeFile(
    join(outputDirectory, 'release-metadata.json'),
    JSON.stringify({ artifact: basename(artifactPath), generated: true }),
  ),
  writeFile(join(outputDirectory, 'build.log'), 'release inputs generated from the Nx server build\n'),
  writeFile(
    join(outputDirectory, 'telemetry.json'),
    JSON.stringify({ event: 'release-inputs-generated', failure: null }),
  ),
]);
