import {
  CryptoContractError,
  deviceChallengeSchema,
  deviceDeliveryLabel,
  deviceDeliverySchema,
  deviceProofMessage,
  deviceProofSchema,
  deliveryBindingSchema,
  type DeviceChallenge,
  type DeviceProof,
  type DeliveryBinding,
  type DeviceDelivery,
  deviceActionMessage,
  deviceActionSchema,
  approvedDeliverySchema,
  signingPinSchema,
  type DeviceAction,
  type SigningPin,
} from '@visomi-stack/shared-persistence';

import { decodeBytes, encodeBytes } from './crypto';

export type DeviceIdentity = { signing: CryptoKeyPair; encryption: CryptoKeyPair };

/** Ephemeral operational identity. Persistent custody must encrypt exported material separately. */
export class WebCryptoDevices {
  private readonly encoder = new TextEncoder();

  constructor(private readonly crypto: Crypto) {}

  async createIdentity(): Promise<DeviceIdentity> {
    const signing = await this.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ]);
    const encryption = await this.crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      false,
      ['encrypt', 'decrypt'],
    );

    return { signing, encryption };
  }

  async publicKeys(identity: DeviceIdentity) {
    const signing = await this.crypto.subtle.exportKey('spki', identity.signing.publicKey);
    const encryption = await this.crypto.subtle.exportKey('spki', identity.encryption.publicKey);

    return { signing: encodeBytes(new Uint8Array(signing)), encryption: encodeBytes(new Uint8Array(encryption)) };
  }

  async prove(identity: DeviceIdentity, input: DeviceChallenge): Promise<DeviceProof> {
    const parsed = deviceChallengeSchema.safeParse(input);

    if (!parsed.success) {
      throw new CryptoContractError('malformed');
    }

    const keys = await this.publicKeys(identity);

    if (keys.signing !== parsed.data.keys.signing || keys.encryption !== parsed.data.keys.encryption) {
      throw new CryptoContractError('context-mismatch');
    }

    const signature = await this.crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      identity.signing.privateKey,
      this.encoder.encode(deviceProofMessage(parsed.data)),
    );
    const result = deviceProofSchema.safeParse({ ...parsed.data, proof: encodeBytes(new Uint8Array(signature)) });

    if (!result.success) {
      throw new CryptoContractError('malformed');
    }

    return result.data;
  }

  /** Application must independently authorize scope/user, validate expiry and consume the challenge. */
  async verify(input: unknown): Promise<boolean> {
    const parsed = deviceProofSchema.safeParse(input);

    if (!parsed.success) {
      return false;
    }

    try {
      await this.importEncryption(parsed.data.keys.encryption);

      const signing = await this.crypto.subtle.importKey(
        'spki',
        decodeBytes(parsed.data.keys.signing, 91),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      const { proof, ...challenge } = parsed.data;
      const verified = await this.crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        signing,
        decodeBytes(proof, 64),
        this.encoder.encode(deviceProofMessage(challenge)),
      );

      return verified;
    } catch {
      return false;
    }
  }

  async fingerprint(input: DeviceChallenge): Promise<string> {
    const proof = deviceProofSchema.safeParse(input);
    let challenge: unknown = input;

    if (proof.success) {
      const { proof: _signature, ...value } = proof.data;

      challenge = value;
    }

    const parsed = deviceChallengeSchema.safeParse(challenge);

    if (!parsed.success) {
      throw new CryptoContractError('malformed');
    }

    const digest = await this.crypto.subtle.digest('SHA-256', this.encoder.encode(deviceProofMessage(parsed.data)));

    return encodeBytes(new Uint8Array(digest));
  }

  async signAction(identity: DeviceIdentity, input: Omit<DeviceAction, 'signature'>): Promise<DeviceAction> {
    const parsed = deviceActionSchema.omit({ signature: true }).safeParse(input);

    if (!parsed.success) {
      throw new CryptoContractError('malformed');
    }

    const message = deviceActionMessage(parsed.data);
    const signature = await this.crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      identity.signing.privateKey,
      this.encoder.encode(message),
    );

    return { ...parsed.data, signature: encodeBytes(new Uint8Array(signature)) };
  }

  async seal(rawDataKey: Uint8Array, input: DeliveryBinding): Promise<DeviceDelivery> {
    const parsed = deliveryBindingSchema.safeParse(input);

    if (!parsed.success || rawDataKey.length !== 32) {
      throw new CryptoContractError('malformed');
    }

    const copy = Uint8Array.from(rawDataKey);

    try {
      const key = await this.importEncryption(parsed.data.encryption);
      const ciphertext = await this.crypto.subtle.encrypt(
        { name: 'RSA-OAEP', label: this.encoder.encode(deviceDeliveryLabel(parsed.data)) },
        key,
        copy,
      );
      const result = deviceDeliverySchema.safeParse({
        format: 'visomi.device-key',
        version: 1,
        algorithm: 'RSA-OAEP-3072-SHA-256',
        binding: parsed.data,
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

  async open(key: CryptoKey, expected: DeliveryBinding, input: unknown): Promise<Uint8Array> {
    const parsed = deviceDeliverySchema.safeParse(input);
    const binding = deliveryBindingSchema.safeParse(expected);

    if (!parsed.success || !binding.success) {
      throw new CryptoContractError('malformed');
    }

    if (deviceDeliveryLabel(parsed.data.binding) !== deviceDeliveryLabel(binding.data)) {
      throw new CryptoContractError('context-mismatch');
    }

    this.assertRsaKey(key);

    if (key.type !== 'private' || key.extractable) {
      throw new CryptoContractError('key-invalid');
    }

    try {
      const result = await this.crypto.subtle.decrypt(
        { name: 'RSA-OAEP', label: this.encoder.encode(deviceDeliveryLabel(binding.data)) },
        key,
        decodeBytes(parsed.data.ciphertext, 384),
      );
      const bytes = new Uint8Array(result);

      if (bytes.length !== 32) {
        bytes.fill(0);

        throw new CryptoContractError('key-invalid');
      }

      return bytes;
    } catch {
      throw new CryptoContractError('integrity-failure');
    }
  }

  /** The signing pin must come from the existing trusted approval channel, never just the fetched cloud roster. */
  async accept(
    key: CryptoKey,
    expected: DeliveryBinding,
    input: unknown,
    trusted: SigningPin,
    historicalGeneration?: number,
  ): Promise<Uint8Array> {
    const parsed = approvedDeliverySchema.safeParse(input);
    const pin = signingPinSchema.safeParse(trusted);
    const binding = deliveryBindingSchema.safeParse(expected);

    if (!parsed.success || !pin.success || !binding.success) {
      throw new CryptoContractError('malformed');
    }

    const { delivery, witness, authorization } = parsed.data;
    const rotation = witness.kind === 'rotation';
    const signedKey = { ...binding.data.key, generation: binding.data.key.generation - (rotation ? 1 : 0) };

    if (
      signedKey.generation < 1 ||
      authorization.deviceId !== pin.data.deviceId ||
      authorization.action !== (rotation ? 'rotate' : 'approve') ||
      deviceActionMessage({ ...authorization, key: signedKey }) !== deviceActionMessage(authorization) ||
      deviceDeliveryLabel(delivery.binding) !== deviceDeliveryLabel(binding.data)
    ) {
      throw new CryptoContractError('context-mismatch');
    }

    const candidates = witness.kind === 'enrollment' ? [witness.delivery] : witness.deliveries;

    if (!candidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(delivery))) {
      throw new CryptoContractError('context-mismatch');
    }

    const history = witness.kind === 'enrollment' ? (witness.history ?? []) : [];
    let previous = 0;

    for (const item of history) {
      const generation = item.binding.key.generation;
      const context = { ...binding.data, key: { ...binding.data.key, generation } };

      if (
        generation <= previous ||
        generation >= binding.data.key.generation ||
        deviceDeliveryLabel(item.binding) !== deviceDeliveryLabel(context)
      ) {
        throw new CryptoContractError('context-mismatch');
      }

      previous = generation;
    }

    const selected =
      historicalGeneration === undefined
        ? delivery
        : history.find((item) => item.binding.key.generation === historicalGeneration);

    if (!selected) {
      throw new CryptoContractError('context-mismatch');
    }

    const body =
      witness.kind === 'enrollment'
        ? { proof: witness.proof, delivery: witness.delivery, ...(witness.history ? { history: witness.history } : {}) }
        : { deliveries: witness.deliveries };

    if (witness.kind === 'enrollment') {
      const fingerprint = await this.fingerprint(witness.proof);

      if (fingerprint !== binding.data.fingerprint) {
        throw new CryptoContractError('context-mismatch');
      }
    }

    try {
      const digest = await this.crypto.subtle.digest('SHA-256', this.encoder.encode(JSON.stringify(body)));
      const signing = await this.crypto.subtle.importKey(
        'spki',
        decodeBytes(pin.data.signing, 91),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      const valid = await this.crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        signing,
        decodeBytes(authorization.signature, 64),
        this.encoder.encode(deviceActionMessage(authorization)),
      );

      if (authorization.bodyHash !== encodeBytes(new Uint8Array(digest)) || !valid) {
        throw new Error();
      }
    } catch {
      throw new CryptoContractError('integrity-failure');
    }
    const raw = await this.open(key, selected.binding, selected);

    return raw;
  }

  private async importEncryption(encoded: string): Promise<CryptoKey> {
    try {
      const key = await this.crypto.subtle.importKey(
        'spki',
        decodeBytes(encoded, 422),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['encrypt'],
      );

      this.assertRsaKey(key);

      return key;
    } catch {
      throw new CryptoContractError('key-invalid');
    }
  }

  private assertRsaKey(key: CryptoKey): void {
    const algorithm = key?.algorithm as Partial<RsaHashedKeyAlgorithm> | undefined;

    if (
      algorithm?.name !== 'RSA-OAEP' ||
      algorithm.modulusLength !== 3072 ||
      algorithm.hash?.name !== 'SHA-256' ||
      !algorithm.publicExponent ||
      encodeBytes(algorithm.publicExponent) !== 'AQAB'
    ) {
      throw new CryptoContractError('key-invalid');
    }
  }
}
