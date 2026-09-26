import { createHash, createHmac } from 'node:crypto';

type OpaqueObjectStore = {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, body: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
};

type RailwayS3Config = {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
};

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function signingKey(secret: string, date: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, 'us-east-1');
  const serviceKey = hmac(regionKey, 's3');

  return hmac(serviceKey, 'aws4_request');
}

function objectUrl(config: RailwayS3Config, key?: string): URL {
  const base = config.endpoint.endsWith('/') ? config.endpoint : `${config.endpoint}/`;
  const url = new URL(base);

  url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(config.bucket)}${
    key === undefined ? '' : `/${key.split('/').map(encodeURIComponent).join('/')}`
  }`;

  return url;
}

class RailwayS3ObjectStore implements OpaqueObjectStore {
  constructor(
    private readonly config: RailwayS3Config,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async get(key: string): Promise<Uint8Array | undefined> {
    const response = await this.request('GET', key);

    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error('Opaque object retrieval failed.');

    return new Uint8Array(await response.arrayBuffer());
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const response = await this.request('PUT', key, body);

    if (!response.ok) throw new Error('Opaque object upload failed.');
  }

  async delete(key: string): Promise<void> {
    const response = await this.request('DELETE', key);

    if (!response.ok && response.status !== 404) throw new Error('Opaque object deletion failed.');
  }

  async ensureBucket(): Promise<void> {
    const response = await this.request('PUT');

    if (!response.ok && response.status !== 409) {
      throw new Error(`Opaque object bucket setup failed (${response.status}).`);
    }
  }

  private async request(method: string, key?: string, body?: Uint8Array): Promise<Response> {
    const url = objectUrl(this.config, key);
    const now = new Date();
    const amzDate = now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256(body ?? new Uint8Array());
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((name) => `${name}:${headers[name].trim()}\n`)
      .join('');
    const canonicalRequest = [
      method,
      url.pathname,
      url.search.slice(1),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const credentialScope = `${date}/us-east-1/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');

    headers['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${createHmac('sha256', signingKey(this.config.secretKey, date)).update(stringToSign).digest('hex')}`;

    return this.fetcher(url, { method, headers, body: body as BodyInit | undefined });
  }
}

export { RailwayS3ObjectStore, sha256 };
export type { OpaqueObjectStore, RailwayS3Config };
