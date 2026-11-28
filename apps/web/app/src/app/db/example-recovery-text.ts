import {
  deliveryBindingSchema,
  encodedBytes,
  scopeTuple,
  signingPinSchema,
  VaultError,
  type DeliveryBinding,
  type KeyDomain,
  type SigningPin,
} from '@visomi-stack/shared-db';
import { decodeBytes } from '@visomi-stack/web-frontend-db';

const maxFileSize = 20_000;
const maxMaterialLength = 8192;

// The importer matches the entire context against the current vault before reading any key material.
function preamble(origin: string, ownerId: string, key: KeyDomain): string {
  const [kind, tenant, group, resource] = scopeTuple(key.scope);

  return [
    '# Visomi Vault recovery key',
    '',
    'Keep this private file somewhere safe outside your device.',
    'To restore access, sign in, open this vault, then choose “Link a device” and “Recover with a saved key”.',
    '',
    'Guarda este archivo privado en un lugar seguro fuera de tu dispositivo.',
    'Para recuperar el acceso, inicia sesión, abre esta bóveda y elige «Vincular un dispositivo» y «Recuperar con una clave guardada».',
    '',
    '## Recovery data',
    'Format: visomi.vault-recovery.v2',
    `Origin: ${origin}`,
    `Owner: ${ownerId}`,
    `Product: ${key.product}`,
    `Domain: ${key.domain}`,
    `Scope: ${kind}`,
    `Tenant: ${tenant}`,
    `Group: ${group ?? '-'}`,
    `Resource: ${resource ?? '-'}`,
    `Generation: ${key.generation}`,
    '',
  ].join('\n');
}

export function writeRecoveryText(
  origin: string,
  recipient: DeliveryBinding,
  signer: SigningPin,
  material: string,
  length: number,
): Blob {
  deliveryBindingSchema.parse(recipient);
  signingPinSchema.parse(signer);

  if (
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > maxMaterialLength ||
    !encodedBytes(length).safeParse(material).success
  ) {
    throw new VaultError('corrupt');
  }

  const fields = [
    `Recipient device: ${recipient.deviceId}`,
    `Request: ${recipient.requestId}`,
    `Challenge: ${recipient.challenge}`,
    `Fingerprint: ${recipient.fingerprint}`,
    `Encryption key: ${recipient.encryption}`,
    `Approving device: ${signer.deviceId}`,
    `Signing key: ${signer.signing}`,
    `Identity bytes: ${length}`,
    `Identity: ${material}`,
    '',
  ];
  const file = new Blob([preamble(origin, recipient.ownerId, recipient.key), fields.join('\n')], {
    type: 'text/plain',
  });

  if (file.size > maxFileSize) {
    throw new VaultError('corrupt');
  }

  return file;
}

export async function readRecoveryText(file: File, key: KeyDomain, ownerId: string, origin: string) {
  if (
    file.size > maxFileSize ||
    !file.name.toLowerCase().endsWith('.txt') ||
    file.type.split(';')[0] !== 'text/plain'
  ) {
    throw new VaultError('recovery-required');
  }

  try {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/\r\n/g, '\n');
    const prefix = preamble(origin, ownerId, key);

    if (!text.startsWith(prefix)) {
      throw new VaultError('recovery-required');
    }

    const lines = text.slice(prefix.length).split('\n');

    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    const field = (label: string) => {
      const line = lines.shift();
      const start = label + ': ';

      if (!line?.startsWith(start)) {
        throw new VaultError('recovery-required');
      }

      return line.slice(start.length);
    };
    const recipient = deliveryBindingSchema.parse({
      key,
      ownerId,
      deviceId: field('Recipient device'),
      requestId: field('Request'),
      challenge: field('Challenge'),
      fingerprint: field('Fingerprint'),
      encryption: field('Encryption key'),
    });
    const signer = signingPinSchema.parse({ deviceId: field('Approving device'), signing: field('Signing key') });
    const size = field('Identity bytes');
    const material = field('Identity');
    const length = Number(size);

    if (lines.length || !/^[1-9][0-9]{0,3}$/.test(size) || length > maxMaterialLength) {
      throw new VaultError('recovery-required');
    }

    return { recipient, signer, bytes: decodeBytes(material, length) };
  } catch {
    // Schema and decoder diagnostics can contain file contents.
    throw new VaultError('recovery-required');
  }
}
