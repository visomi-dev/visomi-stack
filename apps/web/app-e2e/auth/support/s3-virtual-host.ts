import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const directory = process.env['VISOMI_E2E_TELEMETRY_DIR'];
const base = 't3.storageapi.dev';
const bucket = 'visomi-test-vault-backups';

if (
  !directory ||
  process.env['NODE_ENV'] !== 'test' ||
  process.env['PRIVATE_S3_ENDPOINT'] !== `https://${base}` ||
  process.env['PRIVATE_S3_BUCKET'] !== bucket
) {
  throw new Error('isolated_s3_fixture_required');
}

const { endpoint } = JSON.parse(readFileSync(join(directory, 's3.json'), 'utf8')) as { endpoint: string };
const local = new URL(endpoint);

if (local.hostname !== '127.0.0.1' || local.protocol !== 'http:' || local.href !== `${local.origin}/`) {
  throw new Error('isolated_s3_endpoint_invalid');
}

const fetch = globalThis.fetch;

// Route the signed host and object path to disposable SeaweedFS without using Railway DNS or TLS.
globalThis.fetch = async (input, init) => {
  const url = URL.parse(input instanceof Request ? input.url : input);

  if (!url || (url.hostname !== base && !url.hostname.endsWith(`.${base}`))) {
    return fetch(input, init);
  }

  if (
    url.origin !== `https://${bucket}.${base}` ||
    init?.redirect !== 'error' ||
    (init.body != null && typeof init.body !== 'string')
  ) {
    throw new Error('isolated_s3_destination_invalid');
  }

  const target = new URL(local);
  const headers = new Headers(init.headers);

  target.pathname = url.pathname;
  target.search = url.search;
  headers.set('host', url.host);

  // Node fetch replaces the Host header with the connection target. SeaweedFS must verify the signed Host.
  return new Promise<Response>((resolve, reject) => {
    const outgoing = request(
      target,
      { method: init.method, headers: Object.fromEntries(headers), signal: init.signal ?? undefined },
      (response) => {
        const status = response.statusCode!;

        if ((status >= 300 && status < 400) || status === 204) {
          response.resume();

          if (status === 204) {
            resolve(new Response(null, { status }));
          } else {
            reject(new Error('isolated_s3_redirect_rejected'));
          }

          return;
        }

        const headers = new Headers();

        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) {
            headers.set(name, typeof value === 'string' ? value : value.join(', '));
          }
        }

        resolve(new Response(Readable.toWeb(response) as unknown as BodyInit, { status, headers }));
      },
    );

    outgoing.on('error', reject);
    outgoing.end(init.body);
  });
};
