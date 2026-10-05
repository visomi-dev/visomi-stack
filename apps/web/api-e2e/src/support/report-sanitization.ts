import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sensitiveKeys =
  /password|pin|token|cookie|authorization|challenge|credential|privatekey|publickey|signature|clientdata|attestation|authenticator|userhandle|proof|session/i;

export function sanitizeText(value: string, redactLongMaterial = false): string {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
  const sanitized = value
    .replace(ansiPattern, '')
    .replace(/\r/g, '')
    .replaceAll(resolve(process.cwd(), 'dist'), '[REPORT_ROOT]')
    .replaceAll(process.cwd(), '[WORKSPACE_ROOT]')
    .replace(
      /("|')((?:password|pin|token|cookie|authorization|challenge(?:Id)?|credential(?:Id)?|rawId|privateKey|publicKey|signature|clientDataJSON|attestationObject|authenticatorData|userHandle|proof|session(?:Id|Token)?))("|')\s*:\s*("|')[^"']*("|')/gi,
      '$1$2$3: "[REDACTED]"',
    )
    .replace(
      /\b[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[1-5][A-Fa-f0-9]{3}-[89ABab][A-Fa-f0-9]{3}-[A-Fa-f0-9]{12}\b/g,
      '[REDACTED-ID]',
    )
    .replace(/\b\d{6}\b/g, '[REDACTED-PIN]')
    .replace(
      /S3cureOpenApi!|themis-api-openapi-e2e-secret|openapi-[A-Za-z0-9-]+(?:@|%40)example\.test|device-[A-Za-z0-9_-]+/g,
      '[REDACTED]',
    );

  return redactLongMaterial ? sanitized.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[REDACTED-MATERIAL]') : sanitized;
}

export function sanitizeJson(value: unknown, key?: string): unknown {
  if (key && sensitiveKeys.test(key)) {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeJson(entryValue, entryKey)]),
    );
  }
  if (typeof value === 'string') {
    return sanitizeText(value, key === 'url' || key === 'text');
  }

  return value;
}

export async function sanitizeReports(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      await sanitizeReports(path);
      continue;
    }
    const content = await readFile(path, 'utf8');

    if (entry.name.endsWith('.json')) {
      try {
        await writeFile(path, JSON.stringify(sanitizeJson(JSON.parse(content)), null, 2));
        continue;
      } catch {
        // Fall through to text redaction for malformed or non-JSON diagnostics.
      }
    }
    await writeFile(path, sanitizeText(content));
  }
}

export function captureOutput(
  stream: NodeJS.ReadableStream,
  output: { value: string },
  rawOutput?: { value: string },
): void {
  stream.on('data', (chunk: Buffer | string) => {
    if (rawOutput) {
      rawOutput.value += chunk.toString();
    }
    const sanitized = sanitizeText(chunk.toString(), true);

    output.value += sanitized;
    process.stdout.write(sanitized);
  });
}
