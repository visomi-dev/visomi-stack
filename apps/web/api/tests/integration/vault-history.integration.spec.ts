import { expect, it } from 'vitest';
import { approvedDeliverySchema, syncHeadSchema, type DeviceDelivery } from '@visomi-stack/shared-db';

import { fixture } from './support/persistence';
import { authorize, boot, deliver, identity, push, request, vaultBase } from './support/vault';

it('binds historical grants to the current signer, recipient, generation and exact approval body', async () => {
  const f = await fixture();
  const signer = identity();
  const recipient = identity();
  const first = await boot(f, signer);
  const created = await f.owner.call(`${vaultBase(f.target)}/sync/push`, 'POST', push(signer, first));

  expect(created.status).toBe(200);
  const rotation = { deliveries: [deliver(first, 2)] };
  const rotated = await f.owner.call(`${vaultBase(f.target)}/devices/rotate`, 'POST', {
    ...rotation,
    authorization: authorize(signer, first.key, 1, 'rotate', rotation),
  });

  expect(rotated.status).toBe(200);
  const current = { ...first.key, generation: 2 };

  for (const variant of ['future', 'duplicate', 'recipient', 'unsigned'] as const) {
    const proof = await request(f.owner, f.target, recipient);
    const delivery = deliver(proof);
    const historical = deliver(proof, 1);
    const history: DeviceDelivery[] =
      variant === 'future'
        ? [delivery]
        : variant === 'duplicate'
          ? [historical, historical]
          : variant === 'recipient'
            ? [{ ...historical, binding: { ...historical.binding, ownerId: signer.id } }]
            : [historical];
    const body = { proof, delivery, history };
    const result = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...body,
      authorization: authorize(signer, current, 2, 'approve', variant === 'unsigned' ? { proof, delivery } : body),
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: variant === 'unsigned' ? 'device_proof_invalid' : 'device_history_invalid' });
  }

  const proof = await request(f.owner, f.target, recipient);
  const body = { proof, delivery: deliver(proof), history: [deliver(proof, 1)] };
  const approved = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
    ...body,
    authorization: authorize(signer, current, 2, 'approve', body),
  });

  expect(approved.status).toBe(200);
  const delivery = await f.owner.call(`${vaultBase(f.target)}/devices/${recipient.id}/delivery`);

  expect(delivery.status).toBe(200);
  const value = approvedDeliverySchema.parse(delivery.body);

  expect(value.witness).toEqual({ kind: 'enrollment', ...body });

  const second = await f.owner.call(
    `${vaultBase(f.target)}/sync/push`,
    'POST',
    push(signer, first, syncHeadSchema.parse(created.body), 3, 1, undefined, 'record', 2),
  );

  expect(second.status).toBe(200);
  const nextRotation = { deliveries: [deliver(first, 3), deliver(proof, 3)] };
  const next = await f.owner.call(`${vaultBase(f.target)}/devices/rotate`, 'POST', {
    ...nextRotation,
    authorization: authorize(signer, current, 3, 'rotate', nextRotation),
  });

  expect(next.status).toBe(200);
  const candidate = identity();
  const latest = { ...current, generation: 3 };

  for (const complete of [false, true]) {
    const proof = await request(f.owner, f.target, candidate);
    const history = complete ? [deliver(proof, 1), deliver(proof, 2)] : [deliver(proof, 1)];
    const body = { proof, delivery: deliver(proof), history };
    const result = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...body,
      authorization: authorize(signer, latest, 4, 'approve', body),
    });

    expect(result.status).toBe(complete ? 200 : 409);

    if (!complete) {
      expect(result.body).toEqual({ error: 'device_history_required' });
    }
  }
});
