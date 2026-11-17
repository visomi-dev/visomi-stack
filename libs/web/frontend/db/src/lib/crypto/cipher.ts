import {
  CryptoContractError,
  dataAad,
  dataContextSchema,
  encodedBytes,
  parseDataEnvelope,
  wrappedKeySchema,
  wrappingAad,
  wrappingContextSchema,
  type DataContext,
  type DataEnvelope,
  type VaultCrypto,
  type WrappedKey,
  type WrappingContext,
} from '@visomi-stack/shared-db';

export function encodeBytes(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBytes(encoded: string, length: number): Uint8Array<ArrayBuffer> {
  if (!encodedBytes(length).safeParse(encoded).success) {
    throw new CryptoContractError('malformed');
  }

  return Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
}

function bytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

/** Reference WebCrypto adapter. Native clients implement the same wire/AAD separately. */
export class WebCryptoCipher implements VaultCrypto<CryptoKey> {
  private readonly encoder = new TextEncoder();

  constructor(private readonly crypto: Crypto) {
    if (!crypto?.subtle || typeof crypto.getRandomValues !== 'function') {
      throw new CryptoContractError('crypto-unavailable');
    }
  }

  randomBytes(length: number): Uint8Array<ArrayBuffer> {
    if (!Number.isInteger(length) || length < 1 || length > 32) {
      throw new CryptoContractError('malformed');
    }

    try {
      return this.crypto.getRandomValues(new Uint8Array(length));
    } catch {
      throw new CryptoContractError('crypto-unavailable');
    }
  }

  async importDataKey(raw: Uint8Array): Promise<CryptoKey> {
    if (raw.length !== 32) {
      throw new CryptoContractError('key-invalid');
    }

    const copy = bytes(raw);

    try {
      const key = await this.crypto.subtle.importKey('raw', copy, { name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);

      return key;
    } catch {
      throw new CryptoContractError('crypto-unavailable');
    } finally {
      copy.fill(0);
    }
  }

  async seal(key: CryptoKey, context: DataContext, plaintext: Uint8Array): Promise<DataEnvelope> {
    this.assertKey(key);
    const parsed = dataContextSchema.safeParse(context);

    if (!parsed.success) {
      throw new CryptoContractError('malformed');
    }

    if (plaintext.length > 1_048_576) {
      throw new CryptoContractError('quota-exceeded');
    }

    const nonce = this.randomBytes(12);
    const copy = bytes(plaintext);

    try {
      const result = await this.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: this.encoder.encode(dataAad(parsed.data)), tagLength: 128 },
        key,
        copy,
      );

      return parseDataEnvelope({
        format: 'visomi.data',
        version: 1,
        algorithm: 'A256GCM',
        context: parsed.data,
        nonce: encodeBytes(nonce),
        ciphertext: encodeBytes(new Uint8Array(result)),
      });
    } catch {
      throw new CryptoContractError('crypto-unavailable');
    } finally {
      copy.fill(0);
    }
  }

  async open(key: CryptoKey, expected: DataContext, input: unknown): Promise<Uint8Array<ArrayBuffer>> {
    this.assertKey(key);
    const envelope = parseDataEnvelope(input);
    const parsed = dataContextSchema.safeParse(expected);

    if (!parsed.success) {
      throw new CryptoContractError('malformed');
    }

    const aad = dataAad(parsed.data);

    if (aad !== dataAad(envelope.context)) {
      throw new CryptoContractError('context-mismatch');
    }

    try {
      const result = await this.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: decodeBytes(envelope.nonce, 12),
          additionalData: this.encoder.encode(aad),
          tagLength: 128,
        },
        key,
        decodeBytes(envelope.ciphertext, Math.floor((envelope.ciphertext.length * 6) / 8)),
      );

      return new Uint8Array(result);
    } catch {
      throw new CryptoContractError('integrity-failure');
    }
  }

  async deriveWrappingKey(secret: Uint8Array, context: WrappingContext, salt: string): Promise<CryptoKey> {
    const parsed = wrappingContextSchema.safeParse(context);

    if (!parsed.success || secret.length !== 32) {
      throw new CryptoContractError('key-invalid');
    }

    const saltBytes = decodeBytes(salt, 32);
    const copy = bytes(secret);

    try {
      const root = await this.crypto.subtle.importKey('raw', copy, 'HKDF', false, ['deriveKey']);
      const key = await this.crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: this.encoder.encode(wrappingAad(parsed.data)) },
        root,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );

      return key;
    } catch {
      throw new CryptoContractError('crypto-unavailable');
    } finally {
      copy.fill(0);
    }
  }

  async wrap(secret: Uint8Array, rawDataKey: Uint8Array, context: WrappingContext): Promise<WrappedKey> {
    if (rawDataKey.length !== 32) {
      throw new CryptoContractError('key-invalid');
    }

    const parsed = wrappingContextSchema.safeParse(context);

    if (!parsed.success) {
      throw new CryptoContractError('malformed');
    }

    const salt = encodeBytes(this.randomBytes(32));
    const nonce = this.randomBytes(12);
    const copy = bytes(rawDataKey);

    try {
      const key = await this.deriveWrappingKey(secret, parsed.data, salt);
      const ciphertext = await this.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: this.encoder.encode(wrappingAad(parsed.data)), tagLength: 128 },
        key,
        copy,
      );
      const result = wrappedKeySchema.safeParse({
        format: 'visomi.wrap',
        version: 1,
        algorithm: 'A256GCM',
        kdf: 'HKDF-SHA-256',
        context: parsed.data,
        salt,
        nonce: encodeBytes(nonce),
        ciphertext: encodeBytes(new Uint8Array(ciphertext)),
      });

      if (!result.success) {
        throw new CryptoContractError('malformed');
      }

      return result.data;
    } catch (error) {
      if (error instanceof CryptoContractError) {
        throw error;
      }

      throw new CryptoContractError('crypto-unavailable');
    } finally {
      copy.fill(0);
    }
  }

  /** Caller owns the returned transient DEK bytes and must erase them after import/wrapping. */
  async unwrap(secret: Uint8Array, expected: WrappingContext, input: unknown): Promise<Uint8Array<ArrayBuffer>> {
    const envelope = wrappedKeySchema.safeParse(input);
    const binding = wrappingContextSchema.safeParse(expected);

    if (!envelope.success || !binding.success) {
      throw new CryptoContractError('malformed');
    }

    if (wrappingAad(envelope.data.context) !== wrappingAad(binding.data)) {
      throw new CryptoContractError('context-mismatch');
    }

    const value = envelope.data;
    const key = await this.deriveWrappingKey(secret, binding.data, value.salt);

    try {
      const plaintext = await this.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: decodeBytes(value.nonce, 12),
          additionalData: this.encoder.encode(wrappingAad(binding.data)),
          tagLength: 128,
        },
        key,
        decodeBytes(value.ciphertext, 48),
      );

      return new Uint8Array(plaintext);
    } catch {
      throw new CryptoContractError('integrity-failure');
    }
  }

  private assertKey(key: CryptoKey) {
    const algorithm = key?.algorithm as Partial<AesKeyAlgorithm> | undefined;

    if (
      key?.type !== 'secret' ||
      key.extractable ||
      algorithm?.name !== 'AES-GCM' ||
      algorithm.length !== 256 ||
      !key.usages.includes('encrypt') ||
      !key.usages.includes('decrypt')
    ) {
      throw new CryptoContractError('key-invalid');
    }
  }
}
