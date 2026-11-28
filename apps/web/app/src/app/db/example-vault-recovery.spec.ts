import type { DeviceAction, DeviceChallenge, WrappingContext } from '@visomi-stack/shared-db';
import { encodeBytes, WebCryptoDevices, type DeviceCustody } from '@visomi-stack/web-frontend-db';

import type { DatabaseHttp } from '../shared/db/http';
import type { VaultSession } from '../shared/vault/vault-session';

import { prepareRecovery, readRecovery } from './example-vault-recovery';

const binding: WrappingContext = {
  origin: 'https://vault.example.test',
  ownerId: crypto.randomUUID(),
  deviceId: crypto.randomUUID(),
  method: 'passkey-prf',
  methodId: 'AQ',
  key: {
    product: 'synthetic',
    domain: 'notes',
    generation: 1,
    scope: { kind: 'resource', tenantId: crypto.randomUUID(), groupId: null, resourceId: crypto.randomUUID() },
  },
};

async function setup() {
  const devices = new WebCryptoDevices(crypto);
  const approver = await devices.createIdentity();
  const custody = {
    publicKeys: () => devices.publicKeys(approver),
    sign: (action: Omit<DeviceAction, 'signature'>) => devices.signAction(approver, action),
  } as DeviceCustody;
  const api = {
    vault: async (_path: string, request: Pick<DeviceChallenge, 'deviceId' | 'keys'>) => ({
      format: 'visomi.device-enrollment',
      version: 1,
      key: binding.key,
      ownerId: binding.ownerId,
      requestId: crypto.randomUUID(),
      challenge: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      ...request,
    }),
  } as DatabaseHttp;
  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  const { file, approval } = await prepareRecovery(
    api,
    '/synthetic',
    {} as VaultSession,
    binding,
    custody,
    1,
    new AbortController().signal,
    dataKey,
  );
  const keys = await custody.publicKeys();
  const signer = { deviceId: binding.deviceId, signing: keys.signing };
  const text = await file.text();

  return { file, approval, signer, devices, dataKey, text };
}

function importFile(content: BlobPart, name = 'synthetic.txt', type = 'text/plain') {
  return readRecovery(new File([content], name, { type }), binding.key, binding.ownerId, binding.origin);
}

describe('user-held recovery text', () => {
  let fixture: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    const prepared = await setup();

    fixture = prepared;
  });

  it('opens the signed delivery using the pins and nonextractable identity restored from UTF-8 text', async () => {
    const { approval, devices, file, signer, text, dataKey } = fixture;

    expect(file.type).toBe('text/plain');
    expect(text.startsWith('# Visomi Vault recovery key\n')).toBe(true);
    expect(text.includes('{')).toBe(false);

    const restored = await importFile('\uFEFF' + text.replace(/\n/g, '\r\n'));

    expect(restored.recipient).toEqual(approval.delivery.binding);
    expect(restored.signer).toEqual(signer);
    expect(restored.identity.encryption.privateKey.extractable).toBe(false);
    const { delivery, proof, authorization } = approval;
    const opened = await devices.accept(
      restored.identity.encryption.privateKey,
      restored.recipient,
      {
        format: 'visomi.approved-device-key',
        version: 1,
        delivery,
        authorization,
        witness: { kind: 'enrollment', proof, delivery },
      },
      restored.signer,
    );

    expect(opened).toEqual(dataKey);
  });

  it('rejects a complete legacy JSON document even with the text filename and MIME type', async () => {
    const { approval, signer, text } = fixture;
    const legacy = JSON.stringify({
      format: 'visomi.vault-recovery.v1',
      origin: binding.origin,
      recipient: approval.delivery.binding,
      signer,
      material: /^Identity: (.+)$/m.exec(text)![1],
      length: Number(/^Identity bytes: (.+)$/m.exec(text)![1]),
    });

    await expect(importFile(legacy)).rejects.toMatchObject({ code: 'recovery-required' });

    await expect(importFile(text, 'synthetic.json')).rejects.toMatchObject({ code: 'recovery-required' });

    await expect(importFile(text, 'synthetic.txt', 'application/json')).rejects.toMatchObject({
      code: 'recovery-required',
    });
  });

  it('rejects incorrect scope, origin, owner, version, duplicate fields, malformed pins and oversize files', async () => {
    const { text } = fixture;

    for (const invalid of [
      text.replace('Group: -', 'Group: ' + crypto.randomUUID()),
      text.replace('Generation: 1', 'Generation: 2'),
      text.replace(binding.origin, 'https://other.example.test'),
      text.replace(binding.ownerId, crypto.randomUUID()),
      text.replace('recovery.v2', 'recovery.v1'),
      text + 'Identity: AA',
      text.replace(/^Signing key: .+$/m, 'Signing key: AA'),
      text.replace(/^Identity bytes: .+$/m, 'Identity bytes: 8193'),
      text.replace(/^Identity: .+$/m, 'Identity: AAA'),
      text.padEnd(20001),
      new Uint8Array([0xc3, 0x28]),
    ]) {
      await expect(importFile(invalid)).rejects.toMatchObject({ code: 'recovery-required' });
    }
  });
});
