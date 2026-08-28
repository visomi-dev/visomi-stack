import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const protectedKeys = /^(contentMarkdown|plaintext|secret|password|pin|token|privateKey|sessionSecret)$/i;
const secretValues =
  /themis-(?:api-openapi-e2e-secret|app-e2e-secret)|S3cureOpenApi!|BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{16,}/i;

const negativeReference =
  /(?:\b(?:no|not)\s+(?:occurrences?|matches?|findings?|instances?)\s+of\s*|\b(?:patterns?|values?|credentials?|secrets?)\s+(?:were\s+)?absent\s*[:=-]?\s*)$/i;
const negativeListContinuation =
  /\b(?:no|not)\s+(?:occurrences?|matches?|findings?|instances?)\s+of\s+.*(?:,|and)\s*$/i;

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

export function scanJson(value: unknown, path: string, findings: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanJson(item, `${path}[${index}]`, findings));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (protectedKeys.test(key) && typeof child === 'string' && child.trim() !== '' && child !== '[REDACTED]') {
      findings.push(`${path}.${key} contains protected plaintext`);
    }
    scanJson(child, `${path}.${key}`, findings);
  }
}

function isExplicitNegativeReference(text: string, index: number): boolean {
  const statementStart = text.lastIndexOf('\n', index) + 1;
  const prefix = text.slice(statementStart, index);
  return negativeReference.test(prefix) || negativeListContinuation.test(prefix);
}

export function scanText(text: string, findings: string[], file: string): void {
  const pattern = new RegExp(secretValues.source, `${secretValues.flags}g`);
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (!isExplicitNegativeReference(text, index)) findings.push(`${file} contains a secret pattern`);
  }
}

export async function scanFiles(paths: string[]): Promise<{ filesScanned: number; findings: string[] }> {
  const files = (await Promise.all(paths.map(filesUnder))).flat();
  const findings: string[] = [];

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    scanText(text, findings, relative(process.cwd(), file));
    if (file.endsWith('.json')) {
      try {
        scanJson(JSON.parse(text) as unknown, relative(process.cwd(), file), findings);
      } catch {
        // Text logs and Playwright diagnostics are scanned by the pattern check above.
      }
    }
  }

  return { filesScanned: files.length, findings };
}

export async function run(): Promise<number> {
  const paths = process.argv.slice(2);
  const { filesScanned, findings } = await scanFiles(paths);

  if (findings.length > 0) {
    console.error(JSON.stringify({ status: 'FAIL', findings }, null, 2));
    return 1;
  }

  console.log(JSON.stringify({ status: 'PASS', filesScanned, findings: [] }, null, 2));
  return 0;
}

if (process.argv[1]?.endsWith('operational-workspace-security-scan.ts')) process.exitCode = await run();
