import { randomUUID } from 'node:crypto';

export type RedactedDiagnostic = Readonly<{ correlationId: string; code: string; message: string }>;

export function redactedDiagnostic(code: string, value: unknown, correlationId = randomUUID()): RedactedDiagnostic {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : 'Request failed.';

  return {
    code,
    correlationId,
    message: message
      .replace(/(authorization|cookie|token|secret|key|signature|challenge)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
      .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
      .slice(0, 180),
  };
}
