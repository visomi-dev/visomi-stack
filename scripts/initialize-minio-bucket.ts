import { createHash, createHmac } from 'node:crypto';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

const endpoint = new URL(process.env['MINIO_ENDPOINT'] ?? 'http://minio:9000');
const bucket = requiredEnvironment('OPAQUE_SYNC_S3_BUCKET');
const accessKey = requiredEnvironment('MINIO_ROOT_USER');
const secretKey = requiredEnvironment('MINIO_ROOT_PASSWORD');
const url = new URL(`${endpoint.toString().replace(/\/$/, '')}/${encodeURIComponent(bucket)}`);
const amzDate = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d{3}Z$/, 'Z');
const date = amzDate.slice(0, 8);
const payloadHash = createHash('sha256').update('').digest('hex');
const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
const signedHeaders = Object.keys(headers).sort().join(';');
const canonicalHeaders = Object.keys(headers)
  .sort()
  .map((name) => `${name}:${headers[name as keyof typeof headers]}\n`)
  .join('');
const canonicalRequest = ['PUT', url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
const scope = `${date}/us-east-1/s3/aws4_request`;
const dateKey = hmac(`AWS4${secretKey}`, date);
const regionKey = hmac(dateKey, 'us-east-1');
const serviceKey = hmac(regionKey, 's3');
const signingKey = hmac(serviceKey, 'aws4_request');
const stringToSign = [
  'AWS4-HMAC-SHA256',
  amzDate,
  scope,
  createHash('sha256').update(canonicalRequest).digest('hex'),
].join('\n');
const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
const response = await fetch(url, {
  method: 'PUT',
  headers: {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  },
});

if (!response.ok && response.status !== 409)
  throw new Error(`MinIO bucket initialization failed with status ${response.status}.`);

console.log(`MinIO bucket '${bucket}' is ready.`);
