import { randomBytes } from 'node:crypto';

import { apiUrl, origin, runId, rawHttpObservations, passkeyHttpObservations } from './openapi-contract-context.ts';
import type { JsonRecord, HttpObservation } from './openapi-contract-context.ts';
import { sanitizeText, sanitizeJson } from './report-sanitization.ts';

export function sessionCookieFrom(response: Response): string | undefined {
  const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = responseHeaders.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  const cookies = values
    .flatMap((value) => value.split(/,(?=[^;,]+=)/))
    .map((value) => value.split(';', 1)[0].trim())
    .filter((value) => value.length > 0 && !value.startsWith('themis.hasSession='));

  return cookies.length > 0 ? cookies.join('; ') : undefined;
}

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as JsonRecord)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize((value as JsonRecord)[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function envelope(workspaceId: string, envelopeId: string, metadata: JsonRecord = {}): JsonRecord {
  return {
    format: 'themis.encrypted-envelope',
    version: 1,
    kind: 'sync-object',
    envelopeId,
    workspaceId,
    recordType: 'workspace-key-distribution',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    associatedData: {},
    metadata,
    nonce: 'bm9uY2U',
    ciphertext: 'Y2lwaGVydGV4dA',
    authTag: 'dGFn',
  };
}

export async function requestJson(
  path: string,
  init: RequestInit,
  expected: number | number[] = 200,
): Promise<JsonRecord> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { Origin: origin, ...init.headers },
  });
  const allowed = Array.isArray(expected) ? expected : [expected];

  if (!allowed.includes(response.status)) {
    throw new Error(`OpenAPI fixture request ${path} returned ${response.status}.`);
  }

  const body = await response.json();

  return body as JsonRecord;
}

export async function requestObservation(path: string, init: RequestInit): Promise<HttpObservation> {
  const correlationId =
    typeof init.headers === 'object' && init.headers !== null && !Array.isArray(init.headers)
      ? String((init.headers as Record<string, string>)['x-request-id'] ?? `${runId}-${randomBytes(8).toString('hex')}`)
      : `${runId}-${randomBytes(8).toString('hex')}`;
  const requestHeaders = {
    Origin: origin,
    ...(init.headers as Record<string, string> | undefined),
    'x-request-id': correlationId,
  };
  const startedAt = performance.now();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: requestHeaders,
  });
  const text = await response.text();
  const timingMs = Math.round((performance.now() - startedAt) * 100) / 100;

  if (
    path.endsWith('/workspace') ||
    path.startsWith('/sync/') ||
    path.startsWith('/auth/passkey/') ||
    path === '/auth/sign-up/verify'
  ) {
    rawHttpObservations.push({
      method: init.method ?? 'GET',
      path,
      status: response.status,
      requestBody: typeof init.body === 'string' ? sanitizeText(init.body, true) : undefined,
      body: sanitizeText(text, true),
    });
  }
  let body: JsonRecord;

  try {
    body = JSON.parse(text) as JsonRecord;
  } catch {
    body = { raw: text };
  }

  const safeRequestHeaders = Object.fromEntries(
    Object.entries(requestHeaders).filter(([key]) => /^(content-type|origin|x-request-id)$/i.test(key)),
  );
  const safeResponseHeaders = Object.fromEntries(
    [...response.headers.entries()]
      .filter(([key]) => /^(content-type|x-request-id|x-correlation-id|set-cookie)$/i.test(key))
      .map(([key, value]) => [key, key.toLowerCase() === 'set-cookie' ? '[PRESENT]' : value]),
  );

  if (path.startsWith('/auth/passkey/') || path === '/auth/sign-up/verify') {
    passkeyHttpObservations.push({
      method: init.method ?? 'GET',
      path,
      status: response.status,
      requestBody: typeof init.body === 'string' ? sanitizeText(init.body, true) : undefined,
      body: sanitizeJson(body) as JsonRecord,
      timingMs,
      requestHeaders: safeRequestHeaders,
      responseHeaders: safeResponseHeaders,
    });
  }

  return {
    method: init.method ?? 'GET',
    path,
    status: response.status,
    body,
    timingMs,
    correlationId,
    requestBody: typeof init.body === 'string' ? sanitizeText(init.body, true) : undefined,
    requestHeaders: safeRequestHeaders,
    responseHeaders: safeResponseHeaders,
    sessionCookie: sessionCookieFrom(response),
  };
}

export function responseCode(observation: HttpObservation): string | undefined {
  return typeof observation.body.code === 'string' ? observation.body.code : undefined;
}

export function requireResponseCode(observation: HttpObservation, expected: string, name: string): void {
  if (responseCode(observation) !== expected) {
    throw new Error(
      `OpenAPI smoke case ${name} returned code ${responseCode(observation) ?? 'none'}, expected ${expected}.`,
    );
  }
}

export function observationDetail(observation: HttpObservation): string {
  const code = responseCode(observation);
  const message = typeof observation.body.message === 'string' ? observation.body.message : 'no application message';

  return `${code ?? 'no application code'}: ${message}`;
}
