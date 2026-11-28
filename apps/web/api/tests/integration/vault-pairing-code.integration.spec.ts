import { vaultSchema } from '@visomi-stack/backend-db';
import { exampleWorkspaceTargetSchema } from '@visomi-stack/shared-db';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { base, enableBackupObjects, fixture, resource } from './support/persistence';
import { authorize, boot, deliver, identity, prove, request, vaultBase } from './support/vault';

enableBackupObjects((objects) => objects);

it('relays pairing code messages once and in order for an active challenge in the same vault and account', async () => {
  const f = await fixture();
  const workspace = await f.owner.call('/example/vault/workspaces/setup', 'POST', {});
  const target = exampleWorkspaceTargetSchema.parse(workspace.body);
  const devices = `${vaultBase(target)}/devices`;
  const first = identity();

  await boot({ ...f, target }, first);

  const recipient = identity();
  const proof = await request(f.owner, target, recipient);
  const { proof: signature, ...challenge } = proof;
  const replacement = prove(recipient, challenge);
  const publish = (value: typeof proof) => f.owner.call(`${devices}/pairing`, 'POST', value);
  const path = `${devices}/pairing/${proof.requestId}/code`;
  const r1 = Buffer.alloc(96, 1).toString('base64url');
  const a1 = {
    loginResponse: Buffer.alloc(320, 2).toString('base64url'),
    signer: { deviceId: first.id, signing: first.keys.signing },
  };
  const r2 = Buffer.alloc(64, 3).toString('base64url');
  const firstMessage = { step: 'r1', r1 };
  const answer = { step: 'a1', a1 };
  const finish = { step: 'r2', r2 };
  const write = (message: unknown) => f.owner.call(path, 'POST', message);

  await expect(f.owner.call(path)).resolves.toMatchObject({
    status: 404,
    body: { error: 'device_challenge_invalid' },
  });

  await expect(write(firstMessage)).resolves.toMatchObject({
    status: 404,
    body: { error: 'device_challenge_invalid' },
  });

  await expect(publish(proof)).resolves.toMatchObject({ status: 200, body: proof });

  expect(replacement.proof).not.toBe(signature);

  await expect(publish(replacement)).resolves.toMatchObject({
    status: 400,
    body: { error: 'device_challenge_invalid' },
  });

  await expect(publish(proof)).resolves.toMatchObject({ status: 200, body: proof });

  await expect(f.outsider.call(path)).resolves.toMatchObject({ status: 403 });

  await expect(f.outsider.call(path, 'POST', firstMessage)).resolves.toMatchObject({ status: 403 });

  const second = await f.owner.call(`${base(f.tenant)}/children`, 'POST', { kind: 'resource', objectBackup: true });
  const otherTarget = exampleWorkspaceTargetSchema.parse(second.body);

  await boot({ ...f, target: otherTarget }, first);

  await expect(
    f.owner.call(`${vaultBase(otherTarget)}/devices/pairing/${proof.requestId}/code`, 'POST', firstMessage),
  ).resolves.toMatchObject({ status: 404 });

  await expect(write(answer)).resolves.toMatchObject({ status: 409 });

  await expect(write(finish)).resolves.toMatchObject({ status: 409 });

  await expect(write({ ...firstMessage, code: '00000000' })).resolves.toMatchObject({ status: 400 });

  await expect(write({ ...firstMessage, r1: r1.slice(1) + '=' })).resolves.toMatchObject({ status: 400 });

  await expect(write({ ...firstMessage, r1: r1 + 'A' })).resolves.toMatchObject({ status: 400 });

  await expect(f.owner.call(path)).resolves.toMatchObject({ status: 200, body: { r1: null, a1: null, r2: null } });

  const concurrent = await Promise.all([write(firstMessage), write(firstMessage)]);

  expect(concurrent.map(({ status }) => status).sort()).toEqual([200, 409]);

  await expect(write(finish)).resolves.toMatchObject({ status: 409 });

  await expect(write(answer)).resolves.toMatchObject({ status: 200 });

  await expect(write(answer)).resolves.toMatchObject({ status: 409 });

  await expect(write(finish)).resolves.toMatchObject({ status: 200 });

  await expect(write(finish)).resolves.toMatchObject({ status: 409 });

  await expect(f.owner.call(path)).resolves.toMatchObject({ status: 200, body: { r1, a1, r2 } });

  const body = { proof, delivery: deliver(proof) };
  const authorization = authorize(first, proof.key, 1, 'approve', body);

  await expect(f.owner.call(`${devices}/approve`, 'POST', { ...body, authorization })).resolves.toMatchObject({
    status: 200,
  });

  await expect(f.owner.call(path)).resolves.toMatchObject({ status: 404 });

  await expect(write(finish)).resolves.toMatchObject({ status: 404 });

  const later = await request(f.owner, target, identity());
  const laterPath = `${devices}/pairing/${later.requestId}/code`;

  await expect(f.owner.call(`${devices}/pairing`, 'POST', later)).resolves.toMatchObject({ status: 200 });

  const registry = eq(vaultSchema.keyScopes.scopeId, target.scopeId);

  await resource.db.update(vaultSchema.keyScopes).set({ generation: 2 }).where(registry);

  await expect(f.owner.call(laterPath, 'POST', firstMessage)).resolves.toMatchObject({ status: 404 });

  await resource.db.update(vaultSchema.keyScopes).set({ generation: 1 }).where(registry);

  await resource.db
    .update(vaultSchema.keyChallenges)
    .set({ expiresAt: new Date(0) })
    .where(eq(vaultSchema.keyChallenges.id, later.requestId));

  await expect(f.owner.call(laterPath, 'POST', firstMessage)).resolves.toMatchObject({ status: 404 });
});
