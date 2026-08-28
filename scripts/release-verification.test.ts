import { generateKeyPairSync } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

import {
  createReleaseManifest,
  createSignedKeyCatalogue,
  installVerifiedCandidate,
  parseReleaseManifest,
  normalizeArtifactIdentity,
  redactedFailureMessage,
  scanReleaseInputs,
  scanReleaseFiles,
  verifyReleaseFiles,
  verifyReleaseGate,
  verifySignedKeyCatalogue,
  verifyCandidateUpdate,
  verifyReleaseManifest,
  ReleaseVerificationError,
  type KeyCatalogueEntry,
} from './release-verification.ts';

const catalogueEntry = (
  keyId: string,
  publicKey: KeyCatalogueEntry['publicKey'],
  overrides: Partial<KeyCatalogueEntry> = {},
): KeyCatalogueEntry => ({
  keyId,
  publicKey,
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2027-01-01T00:00:00.000Z',
  revoked: false,
  ...overrides,
});

test('accepts a signed fixture and rejects tampering or an unknown signer', () => {
  const trusted = generateKeyPairSync('ed25519');
  const untrusted = generateKeyPairSync('ed25519');
  const artifact = Buffer.from('synthetic release fixture\n', 'utf8');
  const manifest = createReleaseManifest('themis-agent-fixture.tgz', artifact, trusted.privateKey, 'trusted-key-1');

  assert.equal(verifyReleaseManifest(manifest, artifact, trusted.publicKey), true);
  assert.equal(verifyReleaseManifest(manifest, Buffer.from('tampered fixture\n'), trusted.publicKey), false);
  assert.equal(verifyReleaseManifest(manifest, artifact, untrusted.publicKey), false);
  assert.equal(
    verifyReleaseManifest({ ...manifest, signature: 'not-a-signature' }, artifact, trusted.publicKey),
    false,
  );
});

test('uses safe artifact identity and redacts filesystem paths', () => {
  assert.equal(normalizeArtifactIdentity('/tmp/private/customer-secret/themis-agent.tgz'), 'themis-agent.tgz');
  assert.throws(() => normalizeArtifactIdentity('/tmp/private/customer-secret/release with spaces.tgz'));
});

test('rejects an invalid update before any install operation', () => {
  const trusted = generateKeyPairSync('ed25519');
  const candidate = Buffer.from('candidate', 'utf8');
  const currentInstall = { value: 'current-install' };
  let unpacked = false;
  let executed = false;
  const manifest = createReleaseManifest('candidate.tgz', candidate, trusted.privateKey, 'trusted-key-1');

  assert.throws(() =>
    installVerifiedCandidate(
      { ...manifest, signature: 'tampered' },
      candidate,
      new Map([['trusted-key-1', catalogueEntry('trusted-key-1', trusted.publicKey)]]),
      () => {
        unpacked = true;
      },
      () => {
        executed = true;
        currentInstall.value = 'candidate-install';
      },
    ),
  );
  assert.equal(unpacked, false);
  assert.equal(executed, false);
  assert.equal(currentInstall.value, 'current-install');
});

test('scans manifests, artifacts, generated metadata, build logs, and telemetry fail-closed', () => {
  const keys = generateKeyPairSync('ed25519');
  const artifact = Buffer.from('opaque release fixture', 'utf8');
  const manifest = createReleaseManifest('agent.tgz', artifact, keys.privateKey);
  const safeInputs = [
    { name: 'manifest.json', contents: JSON.stringify(manifest) },
    { name: 'agent.tgz', contents: artifact },
    { name: 'metadata.json', contents: '{"artifact":"agent.tgz"}' },
    { name: 'build.log', contents: redactedFailureMessage('invalid-signature') },
    { name: 'telemetry.json', contents: '{"failure":"invalid-signature"}' },
  ] as const;
  scanReleaseInputs(safeInputs);

  assert.throws(
    () => scanReleaseInputs([...safeInputs, { name: 'metadata.json', contents: 'project context: confidential' }]),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'protected-plaintext-detected',
  );
});

test('does not classify uppercase configuration identifiers as leaked values', () => {
  assert.doesNotThrow(() =>
    scanReleaseInputs([{ name: 'server.js', contents: 'MAILGUN_API_KEY: z.string().default("")' }]),
  );
});

test('scans the actual release input files and fails when a protected value is inserted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'release-scan-'));
  const paths = ['manifest.json', 'artifact.tgz', 'metadata.json', 'build.log', 'telemetry.json'].map((name) =>
    join(directory, name),
  );
  await Promise.all(paths.map((path) => writeFile(path, 'opaque release fixture', 'utf8')));
  await scanReleaseFiles(paths);
  await writeFile(paths[3], 'authorization: bearer-secret', 'utf8');
  await assert.rejects(
    scanReleaseFiles(paths),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'protected-plaintext-detected',
  );
});

test('requires a trusted key id, supporting rotation and emergency revocation', () => {
  const oldKey = generateKeyPairSync('ed25519');
  const newKey = generateKeyPairSync('ed25519');
  const artifact = Buffer.from('rotated', 'utf8');
  const manifest = createReleaseManifest('rotated.tgz', artifact, newKey.privateKey, 'trusted-key-2');
  const rotatedKeys = new Map([['trusted-key-2', catalogueEntry('trusted-key-2', newKey.publicKey)]]);

  assert.throws(() =>
    verifyCandidateUpdate(
      manifest,
      artifact,
      new Map([['trusted-key-1', catalogueEntry('trusted-key-1', oldKey.publicKey)]]),
    ),
  );
  verifyCandidateUpdate(manifest, artifact, rotatedKeys);
  rotatedKeys.set('trusted-key-2', catalogueEntry('trusted-key-2', newKey.publicKey, { revoked: true }));
  assert.throws(
    () => verifyCandidateUpdate(manifest, artifact, rotatedKeys),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'revoked-key',
  );
});

test('authenticates the key catalogue and rejects catalogue signature failure', () => {
  const signer = generateKeyPairSync('ed25519');
  const release = generateKeyPairSync('ed25519');
  const catalogue = createSignedKeyCatalogue([catalogueEntry('release-key', release.publicKey)], signer.privateKey);
  const verified = verifySignedKeyCatalogue(catalogue, signer.publicKey);
  assert.equal(verified.get('release-key')?.keyId, 'release-key');
  assert.throws(
    () => verifySignedKeyCatalogue({ ...catalogue, signature: `${catalogue.signature}tampered` }, signer.publicKey),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'catalogue-signature-invalid',
  );
});

test('release gate clean input PASS is distinct from tamper rejection PASS', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'release-gate-'));
  const signer = generateKeyPairSync('ed25519');
  const release = generateKeyPairSync('ed25519');
  const artifactPath = join(directory, 'themis-agent.tgz');
  const manifestPath = join(directory, 'themis.release-manifest.json');
  const cataloguePath = join(directory, 'themis.key-catalogue.json');
  const catalogueKeyPath = join(directory, 'catalogue-key.pem');
  const metadataPath = join(directory, 'release-metadata.json');
  const logPath = join(directory, 'build.log');
  const telemetryPath = join(directory, 'telemetry.json');
  const artifact = Buffer.from('generated agent archive bytes\n', 'utf8');
  const manifest = createReleaseManifest('themis-agent.tgz', artifact, release.privateKey, 'release-key');
  const catalogue = createSignedKeyCatalogue([catalogueEntry('release-key', release.publicKey)], signer.privateKey);
  await Promise.all([
    writeFile(artifactPath, artifact),
    writeFile(manifestPath, `${JSON.stringify(manifest)}\n`),
    writeFile(cataloguePath, `${JSON.stringify(catalogue)}\n`),
    writeFile(catalogueKeyPath, signer.publicKey.export({ type: 'spki', format: 'pem' })),
    writeFile(metadataPath, JSON.stringify({ artifact: 'themis-agent.tgz', generated: true })),
    writeFile(logPath, 'release verification status: accepted\n'),
    writeFile(telemetryPath, JSON.stringify({ event: 'release-verified', failure: null })),
  ]);
  await verifyReleaseGate(artifactPath, manifestPath, cataloguePath, catalogueKeyPath, [
    metadataPath,
    logPath,
    telemetryPath,
  ]);
  await execFile(process.execPath, [
    '--experimental-strip-types',
    join(process.cwd(), 'scripts/release-verification.ts'),
    'gate',
    artifactPath,
    catalogueKeyPath,
    manifestPath,
    cataloguePath,
    catalogueKeyPath,
    metadataPath,
    logPath,
    telemetryPath,
  ]);
  // Clean input is a genuine gate PASS. The tampered input below is also a
  // PASS for the security check only when rejection is observed fail-closed.
  await writeFile(metadataPath, 'project context: protected\n');
  await assert.rejects(
    verifyReleaseGate(artifactPath, manifestPath, cataloguePath, catalogueKeyPath, [
      metadataPath,
      logPath,
      telemetryPath,
    ]),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'protected-plaintext-detected',
  );
});

test('expected tamper rejection PASS never accepts protected release metadata', async () => {
  const keys = generateKeyPairSync('ed25519');
  const catalogueSigner = generateKeyPairSync('ed25519');
  const artifact = Buffer.from('opaque artifact', 'utf8');
  const manifest = createReleaseManifest('agent.tgz', artifact, keys.privateKey);
  const catalogue = createSignedKeyCatalogue(
    [catalogueEntry('release-key-1', keys.publicKey)],
    catalogueSigner.privateKey,
  );
  const directory = await mkdtemp(join(tmpdir(), 'release-tamper-'));
  const paths = {
    artifact: join(directory, 'agent.tgz'),
    manifest: join(directory, 'manifest.json'),
    catalogue: join(directory, 'catalogue.json'),
    catalogueKey: join(directory, 'catalogue-key.pem'),
    metadata: join(directory, 'metadata.json'),
  };
  await Promise.all([
    writeFile(paths.artifact, artifact),
    writeFile(paths.manifest, JSON.stringify(manifest)),
    writeFile(paths.catalogue, JSON.stringify(catalogue)),
    writeFile(paths.catalogueKey, catalogueSigner.publicKey.export({ type: 'spki', format: 'pem' })),
    writeFile(paths.metadata, 'authorization: tampered-secret'),
  ]);

  await assert.rejects(
    verifyReleaseGate(paths.artifact, paths.manifest, paths.catalogue, paths.catalogueKey, [paths.metadata]),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'protected-plaintext-detected',
  );
});

test('returns stable verification errors for malformed manifests and key catalogue entries', () => {
  assert.throws(
    () => parseReleaseManifest(undefined),
    (error: unknown) => {
      return error instanceof ReleaseVerificationError && error.failure === 'malformed-manifest';
    },
  );
  assert.throws(
    () => parseReleaseManifest([]),
    (error: unknown) => {
      return error instanceof ReleaseVerificationError && error.failure === 'malformed-manifest';
    },
  );
  assert.throws(
    () => parseReleaseManifest('{not-json}' as unknown),
    (error: unknown) => {
      return error instanceof ReleaseVerificationError && error.failure === 'malformed-manifest';
    },
  );
  assert.throws(
    () => verifyCandidateUpdate({} as never, Buffer.from('x'), new Map()),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'malformed-manifest',
  );
  const keys = generateKeyPairSync('ed25519');
  const manifest = createReleaseManifest('fixture', Buffer.from('x'), keys.privateKey, 'broken');
  assert.throws(
    () => verifyCandidateUpdate(manifest, Buffer.from('x'), new Map([['broken', null as never]])),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'malformed-key',
  );
});

test('returns stable errors for missing manifest/key files and invalid key files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'release-verification-'));
  const artifactPath = join(directory, 'artifact.tgz');
  const keyPath = join(directory, 'key.pem');
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(artifactPath, 'artifact', 'utf8');
  await writeFile(keyPath, 'not a key', 'utf8');

  await assert.rejects(
    verifyReleaseFiles(artifactPath, join(directory, 'missing-key.pem'), manifestPath),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'missing-key',
  );
  await assert.rejects(
    verifyReleaseFiles(artifactPath, keyPath, manifestPath),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'missing-manifest',
  );
  await writeFile(manifestPath, '{}', 'utf8');
  await assert.rejects(
    verifyReleaseFiles(artifactPath, keyPath, manifestPath),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'malformed-manifest',
  );
  const validKeys = generateKeyPairSync('ed25519');
  await writeFile(
    manifestPath,
    JSON.stringify(createReleaseManifest('artifact.tgz', Buffer.from('artifact'), validKeys.privateKey)),
  );
  await writeFile(manifestPath, '{not-json}', 'utf8');
  await assert.rejects(
    verifyReleaseFiles(artifactPath, keyPath, manifestPath),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'malformed-manifest',
  );
  await writeFile(
    manifestPath,
    JSON.stringify(createReleaseManifest('artifact.tgz', Buffer.from('artifact'), validKeys.privateKey)),
  );
  await assert.rejects(
    verifyReleaseFiles(artifactPath, keyPath, manifestPath),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'malformed-key',
  );
});

test('enforces key validity windows without deleting catalogue entries', () => {
  const keys = generateKeyPairSync('ed25519');
  const artifact = Buffer.from('windowed', 'utf8');
  const manifest = createReleaseManifest('windowed', artifact, keys.privateKey, 'windowed-key');
  const catalogue = new Map([
    [
      'windowed-key',
      catalogueEntry('windowed-key', keys.publicKey, {
        validFrom: '2026-06-01T00:00:00.000Z',
        validUntil: '2026-07-01T00:00:00.000Z',
      }),
    ],
  ]);
  assert.throws(() => verifyCandidateUpdate(manifest, artifact, catalogue, new Date('2026-05-31T23:59:59Z')));
  assert.throws(
    () => verifyCandidateUpdate(manifest, artifact, catalogue, new Date('2026-07-01T00:00:00Z')),
    (error: unknown) => error instanceof ReleaseVerificationError && error.failure === 'key-expired',
  );
});

test('binds the manifest to artifact identity and size', () => {
  const keys = generateKeyPairSync('ed25519');
  const artifact = Buffer.from('fixture', 'utf8');
  const manifest = createReleaseManifest('fixture', artifact, keys.privateKey);

  assert.equal(verifyReleaseManifest({ ...manifest, artifact: 'different-fixture' }, artifact, keys.publicKey), false);
  assert.equal(verifyReleaseManifest({ ...manifest, size: artifact.byteLength + 1 }, artifact, keys.publicKey), false);
});
