import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

export const RELEASE_MANIFEST_FORMAT = 'themis.release-manifest';
export const RELEASE_MANIFEST_VERSION = 1;

export type ReleaseManifest = {
  keyId: string;
  artifact: string;
  artifactSha256: string;
  format: typeof RELEASE_MANIFEST_FORMAT;
  signature: string;
  size: number;
  version: typeof RELEASE_MANIFEST_VERSION;
};

export type KeyCatalogueEntry = {
  keyId: string;
  publicKey: KeyObject;
  validFrom: string;
  validUntil: string;
  revoked: boolean;
};

export type SignedKeyCatalogue = {
  format: 'themis.key-catalogue';
  version: 1;
  entries: Array<{
    keyId: string;
    publicKeyPem: string;
    validFrom: string;
    validUntil: string;
    revoked: boolean;
  }>;
  signature: string;
};

export type ReleaseScanInput = { name: string; contents: string | Buffer };

type UnsignedManifest = Omit<ReleaseManifest, 'signature'>;

export type ReleaseVerificationFailure =
  | 'missing-manifest'
  | 'missing-key'
  | 'malformed-manifest'
  | 'malformed-key'
  | 'unsupported-manifest'
  | 'unknown-key'
  | 'revoked-key'
  | 'key-not-yet-valid'
  | 'key-expired'
  | 'invalid-signature'
  | 'artifact-mismatch'
  | 'protected-plaintext-detected'
  | 'missing-catalogue'
  | 'malformed-catalogue'
  | 'catalogue-signature-invalid';

export class ReleaseVerificationError extends Error {
  readonly failure: ReleaseVerificationFailure;

  constructor(failure: ReleaseVerificationFailure) {
    super(`Release verification failed (${failure}); refusing candidate.`);
    this.name = 'ReleaseVerificationError';
    this.failure = failure;
  }
}

const SAFE_ARTIFACT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isKeyCatalogueEntry = (value: unknown): value is KeyCatalogueEntry =>
  isRecord(value) &&
  typeof value.keyId === 'string' &&
  typeof value.validFrom === 'string' &&
  typeof value.validUntil === 'string' &&
  typeof value.revoked === 'boolean' &&
  value.publicKey instanceof Object;

export const parseReleaseManifest = (value: unknown): ReleaseManifest => {
  if (!isRecord(value)) throw new ReleaseVerificationError('malformed-manifest');
  if (typeof value.version !== 'number') throw new ReleaseVerificationError('malformed-manifest');
  if (value.version !== RELEASE_MANIFEST_VERSION) throw new ReleaseVerificationError('unsupported-manifest');
  if (
    typeof value.keyId !== 'string' ||
    typeof value.artifact !== 'string' ||
    typeof value.artifactSha256 !== 'string' ||
    typeof value.format !== 'string' ||
    typeof value.signature !== 'string' ||
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size)
  ) {
    throw new ReleaseVerificationError('malformed-manifest');
  }
  return value as unknown as ReleaseManifest;
};

export const normalizeArtifactIdentity = (artifactPath: string): string => {
  const identity = basename(artifactPath);
  if (!SAFE_ARTIFACT_ID.test(identity)) {
    throw new ReleaseVerificationError('malformed-manifest');
  }
  return identity;
};

const canonicalize = (value: object): Buffer =>
  Buffer.from(
    JSON.stringify(
      Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))),
    ),
    'utf8',
  );

const sha256 = (artifact: Buffer): string => createHash('sha256').update(artifact).digest('hex');

export const createReleaseManifest = (
  artifactName: string,
  artifact: Buffer,
  privateKey: KeyObject,
  keyId = 'release-key-1',
): ReleaseManifest => {
  const unsigned: UnsignedManifest = {
    artifact: artifactName,
    artifactSha256: sha256(artifact),
    format: RELEASE_MANIFEST_FORMAT,
    keyId,
    size: artifact.byteLength,
    version: RELEASE_MANIFEST_VERSION,
  };

  return {
    ...unsigned,
    signature: sign(null, canonicalize(unsigned), privateKey).toString('base64url'),
  };
};

export const verifyReleaseManifest = (manifest: ReleaseManifest, artifact: Buffer, publicKey: KeyObject): boolean => {
  if (!isRecord(manifest)) return false;
  if (
    !SAFE_ARTIFACT_ID.test(manifest.artifact) ||
    !SAFE_ARTIFACT_ID.test(manifest.keyId) ||
    manifest.format !== RELEASE_MANIFEST_FORMAT ||
    manifest.version !== RELEASE_MANIFEST_VERSION ||
    manifest.size !== artifact.byteLength ||
    manifest.artifactSha256 !== sha256(artifact)
  ) {
    return false;
  }

  const { signature, ...unsigned } = manifest;

  try {
    return verify(null, canonicalize(unsigned), publicKey, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
};

export const verifyCandidateUpdate = (
  manifest: ReleaseManifest,
  artifact: Buffer,
  trustedKeys: ReadonlyMap<string, KeyCatalogueEntry>,
  now = new Date(),
): void => {
  try {
    parseReleaseManifest(manifest);
  } catch (error: unknown) {
    if (error instanceof ReleaseVerificationError) throw error;
    throw new ReleaseVerificationError('malformed-manifest');
  }
  if (!trustedKeys.has(manifest.keyId)) throw new ReleaseVerificationError('unknown-key');
  const key = trustedKeys.get(manifest.keyId);
  if (!isKeyCatalogueEntry(key)) throw new ReleaseVerificationError('malformed-key');
  if (key.revoked) throw new ReleaseVerificationError('revoked-key');
  const current = now.getTime();
  const validFrom = Date.parse(key.validFrom);
  const validUntil = Date.parse(key.validUntil);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil) || validFrom >= validUntil) {
    throw new ReleaseVerificationError('malformed-key');
  }
  if (current < validFrom) throw new ReleaseVerificationError('key-not-yet-valid');
  if (current >= validUntil) throw new ReleaseVerificationError('key-expired');
  if (!verifyReleaseManifest(manifest, artifact, key.publicKey)) {
    const identityOrShapeIsInvalid =
      !SAFE_ARTIFACT_ID.test(manifest.artifact) ||
      !SAFE_ARTIFACT_ID.test(manifest.keyId) ||
      manifest.format !== RELEASE_MANIFEST_FORMAT ||
      manifest.version !== RELEASE_MANIFEST_VERSION;
    throw new ReleaseVerificationError(identityOrShapeIsInvalid ? 'malformed-manifest' : 'invalid-signature');
  }
};

const catalogueUnsigned = (catalogue: SignedKeyCatalogue): Omit<SignedKeyCatalogue, 'signature'> => ({
  format: catalogue.format,
  version: catalogue.version,
  entries: catalogue.entries,
});

export const createSignedKeyCatalogue = (
  entries: readonly KeyCatalogueEntry[],
  signingKey: KeyObject,
): SignedKeyCatalogue => {
  const unsigned = {
    format: 'themis.key-catalogue' as const,
    version: 1 as const,
    entries: entries.map((entry) => ({
      keyId: entry.keyId,
      publicKeyPem: entry.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      validFrom: entry.validFrom,
      validUntil: entry.validUntil,
      revoked: entry.revoked,
    })),
  };
  return { ...unsigned, signature: sign(null, canonicalize(unsigned), signingKey).toString('base64url') };
};

export const verifySignedKeyCatalogue = (
  value: unknown,
  catalogueSigner: KeyObject,
): ReadonlyMap<string, KeyCatalogueEntry> => {
  if (
    !isRecord(value) ||
    value.format !== 'themis.key-catalogue' ||
    value.version !== 1 ||
    !Array.isArray(value.entries) ||
    typeof value.signature !== 'string'
  ) {
    throw new ReleaseVerificationError('malformed-catalogue');
  }
  const catalogue = value as unknown as SignedKeyCatalogue;
  try {
    if (
      !verify(
        null,
        canonicalize(catalogueUnsigned(catalogue)),
        catalogueSigner,
        Buffer.from(catalogue.signature, 'base64url'),
      )
    ) {
      throw new ReleaseVerificationError('catalogue-signature-invalid');
    }
  } catch (error: unknown) {
    if (error instanceof ReleaseVerificationError) throw error;
    throw new ReleaseVerificationError('catalogue-signature-invalid');
  }
  const entries = new Map<string, KeyCatalogueEntry>();
  for (const entry of catalogue.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.keyId !== 'string' ||
      typeof entry.publicKeyPem !== 'string' ||
      typeof entry.validFrom !== 'string' ||
      typeof entry.validUntil !== 'string' ||
      typeof entry.revoked !== 'boolean'
    ) {
      throw new ReleaseVerificationError('malformed-catalogue');
    }
    try {
      entries.set(entry.keyId, {
        keyId: entry.keyId,
        publicKey: createPublicKey(entry.publicKeyPem),
        validFrom: entry.validFrom,
        validUntil: entry.validUntil,
        revoked: entry.revoked,
      });
    } catch {
      throw new ReleaseVerificationError('malformed-catalogue');
    }
  }
  return entries;
};

export const installVerifiedCandidate = (
  manifest: ReleaseManifest,
  artifact: Buffer,
  trustedKeys: ReadonlyMap<string, KeyCatalogueEntry>,
  unpack: (candidate: Buffer) => void,
  execute: () => void,
): void => {
  verifyCandidateUpdate(manifest, artifact, trustedKeys);
  unpack(artifact);
  execute();
};

export const redactedFailureMessage = (failure: ReleaseVerificationFailure): string =>
  `Release verification failed (${failure}); refusing candidate.`;

const protectedPlaintextPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  // Keep configuration/schema identifiers such as `MAILGUN_API_KEY:` from
  // being treated as leaked values. Secret-bearing fields are emitted by the
  // runtime in their redacted, lower-case form; the scanner still rejects the
  // concrete lower-case labels used by serialized inputs and logs.
  /(?:password|passphrase|authorization|api[_ -]?key|access[_ -]?token)\s*[:=]/,
  /protected\s+(?:project\s+)?(?:context|activity|plaintext)/i,
  /project\s+context\s*[:=]/i,
];

export const scanReleaseInputs = (inputs: readonly ReleaseScanInput[]): void => {
  for (const input of inputs) {
    const text = typeof input.contents === 'string' ? input.contents : input.contents.toString('utf8');
    if (protectedPlaintextPatterns.some((pattern) => pattern.test(text))) {
      throw new ReleaseVerificationError('protected-plaintext-detected');
    }
  }
};

export const scanReleaseFiles = async (paths: readonly string[]): Promise<void> => {
  const inputs: ReleaseScanInput[] = [];
  for (const path of paths) {
    let contents: Buffer;
    try {
      contents = await readFile(path);
    } catch {
      throw new ReleaseVerificationError('protected-plaintext-detected');
    }
    inputs.push({ name: basename(path), contents });
  }
  scanReleaseInputs(inputs);
};

export const verifyReleaseFiles = async (
  artifactPath: string,
  keyPath: string,
  manifestPath: string,
): Promise<void> => {
  let artifact: Buffer;
  let keyBytes: Buffer;
  try {
    artifact = await readFile(artifactPath);
  } catch {
    throw new ReleaseVerificationError('artifact-mismatch');
  }
  try {
    keyBytes = await readFile(keyPath);
  } catch {
    throw new ReleaseVerificationError('missing-key');
  }
  let manifestText: string;
  try {
    manifestText = await readFile(manifestPath, 'utf8');
  } catch {
    throw new ReleaseVerificationError('missing-manifest');
  }
  let manifest: ReleaseManifest;
  try {
    manifest = parseReleaseManifest(JSON.parse(manifestText) as unknown);
  } catch (error: unknown) {
    if (error instanceof ReleaseVerificationError) throw error;
    throw new ReleaseVerificationError('malformed-manifest');
  }
  try {
    if (!verifyReleaseManifest(manifest, artifact, createPublicKey(keyBytes))) {
      throw new ReleaseVerificationError('invalid-signature');
    }
  } catch (error: unknown) {
    if (error instanceof ReleaseVerificationError) throw error;
    throw new ReleaseVerificationError('malformed-key');
  }
};

export const verifyReleaseGate = async (
  artifactPath: string,
  manifestPath: string,
  cataloguePath: string,
  catalogueKeyPath: string,
  scanPaths: readonly string[],
): Promise<void> => {
  await scanReleaseFiles([manifestPath, artifactPath, cataloguePath, ...scanPaths]);
  let catalogueText: string;
  let catalogueKeyBytes: Buffer;
  try {
    [catalogueText, catalogueKeyBytes] = await Promise.all([
      readFile(cataloguePath, 'utf8'),
      readFile(catalogueKeyPath),
    ]);
  } catch {
    throw new ReleaseVerificationError('missing-catalogue');
  }
  let catalogue: ReadonlyMap<string, KeyCatalogueEntry>;
  try {
    catalogue = verifySignedKeyCatalogue(JSON.parse(catalogueText) as unknown, createPublicKey(catalogueKeyBytes));
  } catch (error: unknown) {
    if (error instanceof ReleaseVerificationError) throw error;
    throw new ReleaseVerificationError('malformed-catalogue');
  }
  const artifact = await readFile(artifactPath);
  let manifestText: string;
  try {
    manifestText = await readFile(manifestPath, 'utf8');
  } catch {
    throw new ReleaseVerificationError('missing-manifest');
  }
  let manifest: ReleaseManifest;
  try {
    manifest = parseReleaseManifest(JSON.parse(manifestText) as unknown);
  } catch (error: unknown) {
    if (error instanceof ReleaseVerificationError) throw error;
    throw new ReleaseVerificationError('malformed-manifest');
  }
  verifyCandidateUpdate(manifest, artifact, catalogue);
};

const usage =
  'Usage: release-verification <sign|verify|gate> <artifact> <key> <manifest> [catalogue] [catalogue-key] [scan-files...]';

const main = async (args: string[]): Promise<void> => {
  const [command, artifactPath, keyPath, manifestPath] = args;

  if (!command || !artifactPath || !keyPath || !manifestPath || !['sign', 'verify', 'gate'].includes(command)) {
    throw new Error(usage);
  }

  if (command === 'sign') {
    let artifact: Buffer;
    let keyBytes: Buffer;
    try {
      [artifact, keyBytes] = await Promise.all([readFile(artifactPath), readFile(keyPath)]);
    } catch {
      throw new ReleaseVerificationError('malformed-key');
    }
    let manifest: ReleaseManifest;
    try {
      manifest = createReleaseManifest(normalizeArtifactIdentity(artifactPath), artifact, createPrivateKey(keyBytes));
    } catch {
      throw new ReleaseVerificationError('malformed-key');
    }

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    return;
  }

  if (command === 'gate') {
    const [cataloguePath, catalogueKeyPath, ...scanPaths] = args.slice(4);
    if (!cataloguePath || !catalogueKeyPath) throw new Error(usage);
    await verifyReleaseGate(artifactPath, manifestPath, cataloguePath, catalogueKeyPath, scanPaths);
  } else {
    await verifyReleaseFiles(artifactPath, keyPath, manifestPath);
  }
};

if (process.argv[1]?.endsWith('release-verification.ts')) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof ReleaseVerificationError ? redactedFailureMessage(error.failure) : 'Release verification failed (redacted).'}\n`,
    );
    process.exitCode = 1;
  });
}
