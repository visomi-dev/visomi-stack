import { randomBytes, randomUUID } from 'node:crypto';

import { vaultSchema } from '@visomi-stack/backend-db';
import {
  devicePublicKeysSchema,
  deviceProofSchema,
  deviceProofMessage,
  deviceDeliverySchema,
  deviceHistorySchema,
  deviceActionSchema,
  deviceActionMessage,
  deviceDeliveryLabel,
  keyDomainId,
  protocolIdSchema,
  type PairingCodeMessage,
  type DeviceAction,
  type DeviceDelivery,
  type DeviceProof,
} from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { input, type Access, type ScopeAccess, type SessionActor } from '../access/service';

import { publicHash, verifyDeviceAction, verifyDeviceProof } from './device-proof';
import { keyPredicate, VaultAccess } from './vault-access';
import { requireHistory } from './device-history';

const { keyScopes, keyDevices, keyChallenges } = vaultSchema;

export const enrollmentRequestSchema = z.strictObject({ deviceId: protocolIdSchema, keys: devicePublicKeysSchema });
export const approvalSchema = z.strictObject({
  proof: deviceProofSchema,
  delivery: deviceDeliverySchema,
  history: deviceHistorySchema.optional(),
  authorization: deviceActionSchema,
});
export const bootstrapSchema = z.union([
  deviceProofSchema,
  z.strictObject({ primary: deviceProofSchema, recovery: approvalSchema }),
]);
export const revokeDeviceSchema = z.strictObject({ deviceId: protocolIdSchema, authorization: deviceActionSchema });
export const rotateDevicesSchema = z.strictObject({
  deliveries: z.array(deviceDeliverySchema).min(1).max(64),
  authorization: deviceActionSchema,
});

/** Cloud controls access and single-use challenges; only authorized clients can create deliveries. */
export class KeyDevices {
  private readonly vault: VaultAccess;

  constructor(private readonly access: Access) {
    this.vault = new VaultAccess(access);
  }

  async publishPairing(actor: SessionActor, target: unknown, raw: unknown) {
    const proof = input(deviceProofSchema, raw);

    if (proof.ownerId !== actor.principal.id) {
      throw new HttpError(403, 'scope_access_denied');
    }

    verifyDeviceProof(proof);

    return this.withExamplePairing(actor, target, proof.requestId, async (context, condition, challenge) => {
      if (
        deviceProofMessage(challenge.value) !== deviceProofMessage(proof) ||
        ('proof' in challenge.value && challenge.value.proof !== proof.proof)
      ) {
        throw new HttpError(400, 'device_challenge_invalid');
      }

      await context.tx.update(keyChallenges).set({ value: proof }).where(condition);

      return proof;
    });
  }

  async readPairing(actor: SessionActor, target: unknown, id: string) {
    return this.withExamplePairing(actor, target, id, async (_context, _condition, challenge) => {
      const proof = deviceProofSchema.safeParse(challenge.value);

      if (!proof.success) {
        throw new HttpError(404, 'device_challenge_invalid');
      }

      return proof.data;
    });
  }

  async readPairingCode(actor: SessionActor, target: unknown, id: string) {
    return this.withExamplePairing(actor, target, id, async (_context, _condition, challenge) => {
      if (!deviceProofSchema.safeParse(challenge.value).success) {
        throw new HttpError(404, 'device_challenge_invalid');
      }

      return { r1: challenge.pairingR1, a1: challenge.pairingA1, r2: challenge.pairingR2 };
    });
  }

  async writePairingCode(actor: SessionActor, target: unknown, id: string, message: PairingCodeMessage) {
    return this.withExamplePairing(actor, target, id, async (context, condition, challenge) => {
      if (!deviceProofSchema.safeParse(challenge.value).success) {
        throw new HttpError(404, 'device_challenge_invalid');
      }

      const slot = {
        r1: keyChallenges.pairingR1,
        a1: keyChallenges.pairingA1,
        r2: keyChallenges.pairingR2,
      }[message.step];
      const previous = { r1: undefined, a1: keyChallenges.pairingR1, r2: keyChallenges.pairingA1 }[message.step];
      const values =
        message.step === 'r1'
          ? { pairingR1: message.r1 }
          : message.step === 'a1'
            ? { pairingA1: message.a1 }
            : { pairingR2: message.r2 };
      const [accepted] = await context.tx
        .update(keyChallenges)
        .set(values)
        .where(and(condition, isNull(slot), previous && isNotNull(previous)))
        .returning({ id: keyChallenges.id });

      if (!accepted) {
        throw new HttpError(409, 'device_state_conflict');
      }

      return { accepted: true as const };
    });
  }

  async request(actor: SessionActor, target: unknown, domain: string, raw: unknown) {
    const value = input(enrollmentRequestSchema, raw);
    const policy = this.vault.policy(domain);

    return this.access.withScope(actor, target, 'read', async (context) => {
      const initial = this.vault.key(context, policy, 1, true);
      const [registry] = await context.tx.select().from(keyScopes).where(keyPredicate(initial));

      if (registry?.phase === 'rotating') {
        throw new HttpError(409, 'rotation_required');
      }

      const pending = await context.tx
        .select({ id: keyChallenges.id })
        .from(keyChallenges)
        .where(
          and(
            eq(keyChallenges.tenantId, initial.scope.tenantId),
            eq(keyChallenges.ownerId, actor.principal.id),
            isNull(keyChallenges.consumedAt),
            gt(keyChallenges.expiresAt, new Date()),
          ),
        )
        .limit(32);

      if (pending.length >= 32) {
        throw new HttpError(429, 'enrollment_quota');
      }

      const expiresAt = new Date(Date.now() + 300_000);
      const challenge = {
        format: 'visomi.device-enrollment' as const,
        version: 1 as const,
        key: { ...initial, generation: registry?.generation ?? 1 },
        ownerId: actor.principal.id,
        deviceId: value.deviceId,
        requestId: randomUUID(),
        challenge: randomBytes(32).toString('base64url'),
        expiresAt: expiresAt.toISOString(),
        keys: value.keys,
      };

      await context.tx.insert(keyChallenges).values({
        tenantId: initial.scope.tenantId,
        scopeId: context.scope.id,
        domain,
        id: challenge.requestId,
        ownerId: actor.principal.id,
        value: challenge,
        expiresAt,
      });

      return challenge;
    });
  }

  async bootstrap(actor: SessionActor, target: unknown, domain: string, raw: unknown) {
    const value = input(bootstrapSchema, raw);
    const proof = 'primary' in value ? value.primary : value;
    const recovery = 'primary' in value ? value.recovery : undefined;

    if (recovery) {
      if (
        recovery.proof.ownerId !== actor.principal.id ||
        recovery.authorization.deviceId !== proof.deviceId ||
        recovery.proof.deviceId === proof.deviceId
      ) {
        throw new HttpError(403, 'scope_access_denied');
      }

      await this.consume(actor, target, domain, recovery.proof);

      verifyDeviceProof(recovery.proof);
    }

    await this.consume(actor, target, domain, proof);

    verifyDeviceProof(proof);
    const policy = this.vault.policy(domain);

    return this.access.withScope(actor, target, 'share', async (context) => {
      const key = this.vault.key(context, policy, 1, true);

      if (
        !context.membership.owner ||
        proof.ownerId !== actor.principal.id ||
        deviceProofMessage({ ...proof, key }) !== deviceProofMessage(proof)
      ) {
        throw new HttpError(403, 'scope_access_denied');
      }

      const [existing] = await context.tx.select().from(keyScopes).where(keyPredicate(key));

      if (existing) {
        throw new HttpError(409, 'key_scope_initialized');
      }

      await context.tx.insert(keyScopes).values({ tenantId: key.scope.tenantId, scopeId: context.scope.id, domain });

      const { proof: _proof, ...challenge } = proof;

      await context.tx.insert(keyDevices).values({
        tenantId: key.scope.tenantId,
        scopeId: context.scope.id,
        domain,
        id: proof.deviceId,
        ownerId: proof.ownerId,
        signing: proof.keys.signing,
        encryption: proof.keys.encryption,
        challenge,
      });

      if (recovery) {
        if (!context.scope.objectBackup) {
          throw new HttpError(403, 'scope_access_denied');
        }

        await this.approveWithin(context, domain, recovery);
      }

      return { generation: 1, epoch: recovery ? 2 : 1, phase: 'ready' as const };
    });
  }

  async approve(actor: SessionActor, target: unknown, domain: string, raw: unknown) {
    const value = input(approvalSchema, raw);

    await this.consume(actor, target, domain, value.proof);

    verifyDeviceProof(value.proof);

    return this.access.withScope(actor, target, 'share', (context) => this.approveWithin(context, domain, value));
  }

  async roster(actor: SessionActor, target: unknown, domain: string) {
    const policy = this.vault.policy(domain);

    return this.access.withScope(actor, target, 'read', async (context) => {
      const { key, registry } = await this.vault.registry(context, policy, true);
      const devices = await context.tx
        .select({
          id: keyDevices.id,
          ownerId: keyDevices.ownerId,
          signing: keyDevices.signing,
          encryption: keyDevices.encryption,
          revokedAt: keyDevices.revokedAt,
        })
        .from(keyDevices)
        .where(this.deviceScope(context, domain));

      return {
        key,
        epoch: registry.epoch,
        phase: registry.phase,
        devices,
        ...(context.scope.objectBackup ? { objectBackup: true } : {}),
      };
    });
  }

  async deliveryFor(actor: SessionActor, target: unknown, domain: string, rawId: unknown) {
    const id = input(protocolIdSchema, rawId);
    const policy = this.vault.policy(domain);

    return this.access.withScope(actor, target, 'read', async (context) => {
      const { registry } = await this.vault.registry(context, policy, true);
      const [device] = await context.tx
        .select({ delivery: keyDevices.delivery })
        .from(keyDevices)
        .where(
          and(
            this.deviceScope(context, domain),
            eq(keyDevices.id, id),
            eq(keyDevices.ownerId, actor.principal.id),
            isNull(keyDevices.revokedAt),
          ),
        );

      if (!device || !device.delivery) {
        throw new HttpError(404, 'device_delivery_unavailable');
      }

      if (device.delivery.delivery.binding.key.generation !== registry.generation) {
        throw new HttpError(409, 'rotation_required');
      }

      return device.delivery;
    });
  }

  async revoke(actor: SessionActor, target: unknown, domain: string, raw: unknown) {
    const value = input(revokeDeviceSchema, raw);
    const policy = this.vault.policy(domain);

    return this.access.withScope(actor, target, 'share', async (context) => {
      const { key, registry } = await this.vault.registry(context, policy, true);

      await this.authorize(context, registry, value.authorization, 'revoke', { deviceId: value.deviceId });

      const [revoked] = await context.tx
        .update(keyDevices)
        .set({ revokedAt: new Date(), delivery: null })
        .where(and(this.deviceScope(context, domain), eq(keyDevices.id, value.deviceId), isNull(keyDevices.revokedAt)))
        .returning({ id: keyDevices.id });

      if (!revoked) {
        throw new HttpError(404, 'device_unavailable');
      }

      await context.tx
        .update(keyScopes)
        .set({ epoch: registry.epoch + 1, phase: 'rotating' })
        .where(keyPredicate(key));

      return { generation: key.generation, epoch: registry.epoch + 1, phase: 'rotating' as const };
    });
  }

  async rotate(actor: SessionActor, target: unknown, domain: string, raw: unknown) {
    const value = input(rotateDevicesSchema, raw);
    const policy = this.vault.policy(domain);

    return this.access.withScope(actor, target, 'share', async (context) => {
      const { key, registry } = await this.vault.registry(context, policy, true);

      await this.authorize(context, registry, value.authorization, 'rotate', { deliveries: value.deliveries });

      if (key.generation >= 2_147_483_647) {
        throw new HttpError(409, 'generation_exhausted');
      }

      const devices = await context.tx
        .select()
        .from(keyDevices)
        .where(and(this.deviceScope(context, domain), isNull(keyDevices.revokedAt)));
      const ids = value.deliveries.map((item) => item.binding.deviceId);

      if (devices.length !== ids.length || new Set(ids).size !== ids.length) {
        throw new HttpError(409, 'rotation_incomplete');
      }

      for (const device of devices) {
        await this.access.requireRecipient(context, device.ownerId);

        const delivery = value.deliveries.find((item) => item.binding.deviceId === device.id);

        if (!delivery) {
          throw new HttpError(409, 'rotation_incomplete');
        }

        this.delivery(device.challenge, delivery, key.generation + 1);

        await context.tx
          .update(keyDevices)
          .set({
            delivery: {
              format: 'visomi.approved-device-key',
              version: 1,
              delivery,
              authorization: value.authorization,
              witness: { kind: 'rotation', deliveries: value.deliveries },
            },
          })
          .where(and(this.deviceScope(context, domain), eq(keyDevices.id, device.id)));
      }

      await context.tx
        .update(keyScopes)
        .set({ generation: key.generation + 1, epoch: registry.epoch + 1, phase: 'ready' })
        .where(keyPredicate(key));

      return { generation: key.generation + 1, epoch: registry.epoch + 1, phase: 'ready' as const };
    });
  }

  private async approveWithin(context: ScopeAccess, domain: string, value: z.infer<typeof approvalSchema>) {
    const policy = this.vault.policy(domain);
    const { key, registry } = await this.vault.registry(context, policy, true);

    if (registry.phase !== 'ready') {
      throw new HttpError(409, 'rotation_required');
    }

    await this.authorize(context, registry, value.authorization, 'approve', {
      proof: value.proof,
      delivery: value.delivery,
      ...(value.history ? { history: value.history } : {}),
    });

    await this.access.requireRecipient(context, value.proof.ownerId);

    const count = await context.tx
      .select({ id: keyDevices.id })
      .from(keyDevices)
      .where(and(this.deviceScope(context, domain), isNull(keyDevices.revokedAt)))
      .limit(64);

    if (count.length >= 64) {
      throw new HttpError(413, 'device_quota');
    }

    this.delivery(value.proof, value.delivery, key.generation);

    await requireHistory(context, key, value.proof, value.history ?? []);

    const { proof: _proof, ...challenge } = value.proof;

    await context.tx.insert(keyDevices).values({
      tenantId: key.scope.tenantId,
      scopeId: context.scope.id,
      domain,
      id: value.proof.deviceId,
      ownerId: value.proof.ownerId,
      signing: value.proof.keys.signing,
      encryption: value.proof.keys.encryption,
      challenge,
      delivery: {
        format: 'visomi.approved-device-key',
        version: 1,
        delivery: value.delivery,
        authorization: value.authorization,
        witness: {
          kind: 'enrollment',
          proof: value.proof,
          delivery: value.delivery,
          ...(value.history ? { history: value.history } : {}),
        },
      },
    });

    await context.tx
      .update(keyScopes)
      .set({ epoch: registry.epoch + 1 })
      .where(keyPredicate(key));

    return { generation: registry.generation, epoch: registry.epoch + 1 };
  }

  private async withExamplePairing<T>(
    actor: SessionActor,
    target: unknown,
    id: string,
    use: (
      context: ScopeAccess,
      condition: ReturnType<typeof and>,
      row: typeof keyChallenges.$inferSelect,
    ) => Promise<T>,
  ) {
    const domain = 'private-resources';
    const policy = this.vault.policy(domain);

    return this.access.withScope(actor, target, 'share', async (context) => {
      const { key, registry } = await this.vault.registry(context, policy, true);

      if (!context.scope.objectBackup || !context.membership.owner || registry.phase !== 'ready') {
        throw new HttpError(403, 'scope_access_denied');
      }

      const condition = and(
        eq(keyChallenges.tenantId, key.scope.tenantId),
        eq(keyChallenges.scopeId, context.scope.id),
        eq(keyChallenges.domain, domain),
        eq(keyChallenges.id, id),
        eq(keyChallenges.ownerId, actor.principal.id),
        isNull(keyChallenges.consumedAt),
        gt(keyChallenges.expiresAt, sql`clock_timestamp()`),
      );
      const [challenge] = await context.tx.select().from(keyChallenges).where(condition);

      if (!challenge || keyDomainId(actor.principal.id, challenge.value.key) !== keyDomainId(actor.principal.id, key)) {
        throw new HttpError(404, 'device_challenge_invalid');
      }

      return use(context, condition, challenge);
    });
  }

  private async consume(actor: SessionActor, target: unknown, domain: string, proof: DeviceProof) {
    const policy = this.vault.policy(domain);
    const accepted = await this.access.withScope(
      actor,
      target,
      proof.ownerId === actor.principal.id ? 'read' : 'share',
      async (context) => {
        const key = this.vault.key(context, policy, proof.key.generation, true);
        const [challenge] = await context.tx
          .update(keyChallenges)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(keyChallenges.tenantId, key.scope.tenantId),
              eq(keyChallenges.scopeId, context.scope.id),
              eq(keyChallenges.domain, domain),
              eq(keyChallenges.id, proof.requestId),
              isNull(keyChallenges.consumedAt),
              gt(keyChallenges.expiresAt, new Date()),
            ),
          )
          .returning();

        return (
          challenge &&
          deviceProofMessage(challenge.value) === deviceProofMessage(proof) &&
          deviceProofMessage({ ...proof, key }) === deviceProofMessage(proof)
        );
      },
    );

    if (!accepted) {
      throw new HttpError(400, 'device_challenge_invalid');
    }
  }

  private async authorize(
    context: ScopeAccess,
    registry: typeof keyScopes.$inferSelect,
    action: DeviceAction,
    expected: DeviceAction['action'],
    body: unknown,
  ) {
    const policy = this.vault.policy(registry.domain);
    const key = this.vault.key(context, policy, registry.generation, true);

    if (
      action.action !== expected ||
      action.epoch !== registry.epoch ||
      deviceActionMessage({ ...action, key }) !== deviceActionMessage(action)
    ) {
      throw new HttpError(409, 'device_state_conflict');
    }

    const [device] = await context.tx
      .select()
      .from(keyDevices)
      .where(
        and(
          this.deviceScope(context, registry.domain),
          eq(keyDevices.id, action.deviceId),
          eq(keyDevices.ownerId, context.actor.principal.id),
          isNull(keyDevices.revokedAt),
        ),
      );

    if (!device) {
      throw new HttpError(403, 'device_approval_required');
    }

    verifyDeviceAction(device.signing, action, body);
  }

  private delivery(challenge: Omit<DeviceProof, 'proof'>, delivery: DeviceDelivery, generation: number) {
    const expected = {
      key: { ...challenge.key, generation },
      ownerId: challenge.ownerId,
      deviceId: challenge.deviceId,
      requestId: challenge.requestId,
      challenge: challenge.challenge,
      fingerprint: publicHash(deviceProofMessage(challenge)),
      encryption: challenge.keys.encryption,
    };

    if (deviceDeliveryLabel(expected) !== deviceDeliveryLabel(delivery.binding)) {
      throw new HttpError(400, 'device_delivery_invalid');
    }
  }

  private deviceScope(context: ScopeAccess, domain: string) {
    return and(
      eq(keyDevices.tenantId, context.target.tenantId),
      eq(keyDevices.scopeId, context.scope.id),
      eq(keyDevices.domain, domain),
    );
  }
}
