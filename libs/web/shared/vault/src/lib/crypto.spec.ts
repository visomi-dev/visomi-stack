import { readFileSync } from 'node:fs';
import { createDecipheriv, hkdfSync, webcrypto } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import {
  dataAad,
  dataEnvelopeSchema,
  deserializeDataEnvelope,
  serializeDataEnvelope,
  wrappingAad,
  wrappedKeySchema,
  type DataEnvelope,
  type WrappedKey,
  type WrappingContext,
} from '@visomi-stack/shared-persistence';

import { decodeBytes, encodeBytes, WebCryptoCipher } from './crypto';

const vectors = JSON.parse(
  readFileSync(new URL('../../../../../shared/persistence/fixtures/crypto-v1.json', import.meta.url), 'utf8'),
) as {
  dataKeyHex: string;
  secretHex: string;
  plaintextHex: string;
  dataAad: string;
  wrappingAad: string;
  derivedWrappingKeyHex: string;
  data: DataEnvelope;
  wrapped: WrappedKey;
};
const cipher = new WebCryptoCipher(webcrypto as unknown as Crypto);
const data = dataEnvelopeSchema.parse(vectors.data);
const wrapped = wrappedKeySchema.parse(vectors.wrapped);
const rawKey = Uint8Array.from(Buffer.from(vectors.dataKeyHex, 'hex'));
const secret = Uint8Array.from(Buffer.from(vectors.secretHex, 'hex'));
const plaintext = Uint8Array.from(Buffer.from(vectors.plaintextHex, 'hex'));

describe('WebCrypto protocol reference against independent public vectors', () => {
  it('snapshots transient wrapping inputs before asynchronous derivation', async () => {
    const localKey = Uint8Array.from(rawKey);
    const localSecret = Uint8Array.from(secret);
    const pending = cipher.wrap(localSecret, localKey, wrapped.context);

    localKey.fill(0);
    localSecret.fill(0);
    const envelope = await pending;
    const recovered = await cipher.unwrap(secret, wrapped.context, envelope);

    expect(recovered).toEqual(rawKey);
    recovered.fill(0);
  });
  it('matches exact AAD, ciphertext and HKDF wrapping bytes from Node cipher APIs', async () => {
    expect(dataAad(data.context)).toBe(vectors.dataAad);
    expect(wrappingAad(wrapped.context)).toBe(vectors.wrappingAad);
    const independent = Buffer.from(
      hkdfSync('sha256', secret, Buffer.from(wrapped.salt, 'base64url'), Buffer.from(vectors.wrappingAad), 32),
    );

    expect(independent.toString('hex')).toBe(vectors.derivedWrappingKeyHex);
    const key = await cipher.importDataKey(rawKey);
    const opened = await cipher.open(key, data.context, data);
    const unwrapped = await cipher.unwrap(secret, wrapped.context, wrapped);

    expect(opened).toEqual(plaintext);
    expect(unwrapped).toEqual(rawKey);
    expect(key.extractable).toBe(false);

    await expect(webcrypto.subtle.exportKey('raw', key as webcrypto.CryptoKey)).rejects.toThrow();

    opened.fill(0);
    unwrapped.fill(0);
    independent.fill(0);
  });

  it('seals fresh nonces and can be decrypted by the independent Node API without altering inputs', async () => {
    const key = await cipher.importDataKey(rawKey);
    const first = await cipher.seal(key, data.context, plaintext);
    const second = await cipher.seal(key, data.context, plaintext);

    expect(first.nonce).not.toBe(second.nonce);
    const encrypted = Buffer.from(first.ciphertext, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', rawKey, Buffer.from(first.nonce, 'base64url'));

    decipher.setAAD(Buffer.from(vectors.dataAad));
    decipher.setAuthTag(encrypted.subarray(-16));
    expect(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()])).toEqual(
      Buffer.from(plaintext),
    );
    expect(rawKey).toEqual(new Uint8Array(32).fill(7));
    expect(secret).toEqual(new Uint8Array(32).fill(9));
  });

  it('round-trips canonical transport and rejects alternate JSON encodings', () => {
    const wire = serializeDataEnvelope(data);

    expect(deserializeDataEnvelope(wire)).toEqual(data);
    expect(() => deserializeDataEnvelope(` ${wire}`)).toThrow();
    expect(() => deserializeDataEnvelope(wire.replace('"version":1', '"version":1,"version":1'))).toThrow();
    expect(() => deserializeDataEnvelope('{synthetic-private-marker')).toThrow('malformed');
    expect(() => deserializeDataEnvelope('x'.repeat(1_410_001))).toThrow('quota-exceeded');
    expect(wire).not.toContain(Buffer.from(plaintext).toString('utf8'));
  });

  it.each(['nonce', 'ciphertext'] as const)('rejects an authenticated %s mutation', async (field) => {
    const key = await cipher.importDataKey(rawKey);
    const changed = Buffer.from(data[field], 'base64url');

    changed[0] ^= 1;

    await expect(
      cipher.open(key, data.context, { ...data, [field]: changed.toString('base64url') }),
    ).rejects.toMatchObject({ code: 'integrity-failure' });
  });

  it.each([
    { context: { ...data.context, key: { ...data.context.key, generation: 2 } } },
    { context: { ...data.context, revision: 2 } },
    { context: { ...data.context, schemaVersion: 2 } },
    { context: { ...data.context, objectId: wrapped.context.deviceId } },
  ])('rejects substituted context before returning plaintext: %j', async (override) => {
    const key = await cipher.importDataKey(rawKey);

    await expect(cipher.open(key, data.context, { ...data, ...override })).rejects.toMatchObject({
      code: 'context-mismatch',
    });

    await expect(cipher.open(key, override.context, { ...data, ...override })).rejects.toMatchObject({
      code: 'integrity-failure',
    });
  });

  it.each([
    { version: 2 },
    { version: 0 },
    { algorithm: 'AES-CBC' },
    { nonce: data.nonce + '=' },
    { ciphertext: 'A' },
    { plaintext: 'synthetic-private-marker' },
    { context: { ...data.context, target: { ...data.context.target, tenantId: wrapped.context.deviceId } } },
  ])('fails closed on malformed or unsupported envelopes: %j', async (override) => {
    const key = await cipher.importDataKey(rawKey);

    await expect(cipher.open(key, data.context, { ...data, ...override })).rejects.toThrow();
  });

  it('requires non-extractable AES-256 operational keys and enforces payload bounds', async () => {
    const extractable = await webcrypto.subtle.importKey('raw', rawKey, 'AES-GCM', true, ['encrypt', 'decrypt']);

    await expect(cipher.seal(extractable as CryptoKey, data.context, plaintext)).rejects.toMatchObject({
      code: 'key-invalid',
    });

    await expect(cipher.importDataKey(new Uint8Array(31))).rejects.toMatchObject({ code: 'key-invalid' });

    const key = await cipher.importDataKey(rawKey);

    await expect(cipher.seal(key, data.context, new Uint8Array(1_048_577))).rejects.toMatchObject({
      code: 'quota-exceeded',
    });

    const maximum = new Uint8Array(1_048_576).fill(42);
    const envelope = await cipher.seal(key, data.context, maximum);
    const result = await cipher.open(key, data.context, envelope);

    expect(result).toEqual(maximum);
    result.fill(0);
  });

  it('wraps only raw 32-byte DEKs and binds owner/device/method/origin and generations', async () => {
    const created = await cipher.wrap(secret, rawKey, wrapped.context);
    const opened = await cipher.unwrap(secret, wrapped.context, created);

    expect(opened).toEqual(rawKey);
    opened.fill(0);

    for (const field of ['ownerId', 'deviceId', 'methodId', 'origin'] as const) {
      const expected = {
        ...wrapped.context,
        [field]: field === 'origin' ? 'https://other.example.test' : data.context.objectId,
      };

      await expect(cipher.unwrap(secret, expected, wrapped)).rejects.toMatchObject({ code: 'context-mismatch' });
    }

    await expect(cipher.unwrap(new Uint8Array(32), wrapped.context, wrapped)).rejects.toMatchObject({
      code: 'integrity-failure',
    });

    await expect(cipher.wrap(secret, new Uint8Array(31), wrapped.context)).rejects.toMatchObject({
      code: 'key-invalid',
    });

    await expect(cipher.deriveWrappingKey(new Uint8Array(31), wrapped.context, wrapped.salt)).rejects.toMatchObject({
      code: 'key-invalid',
    });

    await expect(cipher.unwrap(secret, wrapped.context, { ...wrapped, version: 2 })).rejects.toThrow();

    const invalid = { ...wrapped.context, method: 'password' } as unknown as WrappingContext;

    await expect(cipher.wrap(secret, rawKey, invalid)).rejects.toMatchObject({ code: 'malformed' });
  });

  it('rejects non-canonical binary aliases and unavailable crypto with static errors', () => {
    expect(() => new WebCryptoCipher(undefined as unknown as Crypto)).toThrow('crypto-unavailable');
    expect(() => decodeBytes(wrapped.salt.slice(0, -1) + 'B', 32)).toThrow('malformed');
    expect(() => decodeBytes(wrapped.salt + '=', 32)).toThrow('malformed');
    expect(encodeBytes(decodeBytes(wrapped.salt, 32))).toBe(wrapped.salt);
    expect(() => cipher.randomBytes(33)).toThrow('malformed');
  });
});
