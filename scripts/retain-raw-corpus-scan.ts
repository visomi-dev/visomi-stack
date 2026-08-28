import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { scanFiles } from './operational-workspace-security-scan.ts';

type ScannedArtifact = {
  path: string;
  bytes: number;
  sha256: string;
};

type Surface = {
  name: string;
  inputPath: string;
  artifactCount: number;
  artifacts: ScannedArtifact[];
  absenceReason?: string;
};

const inputs = [
  ['dist/test-results', 'test-results'],
  ['dist/apps', 'built-apps'],
  ['dist/logs', 'runtime-logs'],
  ['dist/queues', 'queue-exports'],
  ['dist/telemetry', 'telemetry-exports'],
  ['dist/evidence', 'verification-evidence'],
  ['playwright-report', 'gateway-playwright-report'],
  ['apps/web/app-e2e/playwright-report', 'app-playwright-report'],
  ['apps/web/app-e2e/src/__snapshots__', 'screenshots-and-snapshots'],
  ['artifacts', 'agent-artifacts'],
  ['.themis', 'exported-themis-evidence'],
] as const;

async function filesUnder(path: string): Promise<string[]> {
  try {
    if ((await stat(path)).isFile()) return [path];
  } catch {
    return [];
  }

  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(child)));
    else files.push(child);
  }
  return files;
}

async function artifactsFor(path: string): Promise<ScannedArtifact[]> {
  const files = await filesUnder(path);
  return Promise.all(
    files.sort().map(async (file) => {
      const contents = await readFile(file);
      return {
        path: relative(process.cwd(), file),
        bytes: contents.byteLength,
        sha256: createHash('sha256').update(contents).digest('hex'),
      };
    }),
  );
}

const outputPaths = [
  'dist/test-results/e2e-001-security/raw-corpus-scan.json',
  'docs/security/zk-014-raw-corpus-scan.json',
];

const command =
  'node --experimental-strip-types scripts/retain-raw-corpus-scan.ts dist/test-results dist/apps dist/logs dist/queues dist/telemetry dist/evidence playwright-report apps/web/app-e2e/playwright-report apps/web/app-e2e/src/__snapshots__ artifacts .themis';
const runId = process.env.THEMIS_RUN_ID ?? 'RUN-197';
const startedAt = new Date().toISOString();
const scan = await scanFiles(inputs.map(([inputPath]) => inputPath));
const surfaces: Surface[] = [];
for (const [inputPath, name] of inputs) {
  const artifacts = await artifactsFor(inputPath);
  surfaces.push({ name, inputPath, artifactCount: artifacts.length, artifacts });
}
surfaces.push(
  {
    name: 'postgresql-metadata',
    inputPath: 'external runtime export',
    artifactCount: 0,
    artifacts: [],
    absenceReason:
      'No standalone PostgreSQL export was present in the scanned workspace corpus; inspect via the separately recorded durable integration check.',
  },
  {
    name: 's3-object-storage',
    inputPath: 'external runtime export',
    artifactCount: 0,
    artifacts: [],
    absenceReason:
      'No standalone S3/MinIO export was present in the scanned workspace corpus; inspect via the separately recorded durable integration check.',
  },
);

const finishedAt = new Date().toISOString();
const manifest = {
  schemaVersion: 1,
  runId,
  command,
  startedAt,
  finishedAt,
  status: scan.findings.length === 0 ? 'PASS' : 'FAIL',
  filesScanned: scan.filesScanned,
  findings: scan.findings,
  surfaces,
  outputPaths,
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
await mkdir('dist/test-results/e2e-001-security', { recursive: true });
await writeFile(outputPaths[0], serialized);
await writeFile(outputPaths[1], serialized);
console.log(
  JSON.stringify(
    { status: manifest.status, filesScanned: manifest.filesScanned, findings: manifest.findings, outputPaths },
    null,
    2,
  ),
);
if (scan.findings.length > 0) process.exitCode = 1;
