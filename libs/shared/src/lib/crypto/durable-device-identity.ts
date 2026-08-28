import { createHash, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import { env } from '../env';
import { getPool } from '../db/pool';

import {
  deserializeEncryptedEnvelope,
  parseEncryptedEnvelope,
  serializeEncryptedEnvelope,
  type EncryptedEnvelope,
} from './encrypted-envelope';
import { RailwayS3ObjectStore, sha256, type OpaqueObjectStore } from './opaque-sync-object-store';
import { DeviceIdentityError, type DeviceAuditEvent, type DeviceIdentity } from './device-identity';

type Grant = {
  deviceId: string;
  enrolledAt: string;
  enrollmentVersion: number;
  keyEnvelope: EncryptedEnvelope;
  workspaceId: string;
};

/** PostgreSQL-backed device authority. Secret keys and plaintext never cross this boundary. */
export class DurableDeviceIdentityStore {
  public constructor(
    private readonly pool: Pool,
    private readonly objects: OpaqueObjectStore,
  ) {}

  static fromConfig(pool: Pool, config: { endpoint: string; bucket: string; accessKey: string; secretKey: string }) {
    return new DurableDeviceIdentityStore(pool, new RailwayS3ObjectStore(config));
  }

  async createIdentity(
    accountId: string,
    publicKey: string,
    label = 'Unnamed device',
    now = new Date(),
    workspaceId?: string,
  ): Promise<DeviceIdentity> {
    if (!accountId || !publicKey || !label)
      throw new DeviceIdentityError('Account, public key, and label are required.');
    const fingerprint = createHash('sha256').update(publicKey).digest('base64url');
    const id = `device-${randomUUID()}`;

    try {
      await this.pool.query(
        `INSERT INTO sync_devices (device_id, account_id, public_key, fingerprint, label, status, created_at) VALUES ($1,$2,$3,$4,$5,'active',$6)`,
        [id, accountId, publicKey, fingerprint, label, now],
      );
      await this.audit(accountId, id, 'created', workspaceId, now);

      return { accountId, createdAt: now.toISOString(), deviceId: id, fingerprint, label, publicKey, status: 'active' };
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message))
        throw new DeviceIdentityError('Device identity already exists for this account.');
      throw error;
    }
  }

  async listDevices(accountId: string): Promise<DeviceIdentity[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT account_id AS "accountId", created_at AS "createdAt", device_id AS "deviceId", fingerprint, label, public_key AS "publicKey", revoked_at AS "revokedAt", status FROM sync_devices WHERE account_id=$1 ORDER BY created_at`,
      [accountId],
    );

    return result.rows.map(
      (row) =>
        ({
          ...row,
          createdAt: new Date(row['createdAt'] as string).toISOString(),
          status: row['status'] as 'active' | 'revoked',
          revokedAt: row['revokedAt'] ? new Date(row['revokedAt'] as string).toISOString() : undefined,
        }) as DeviceIdentity,
    );
  }

  async approveWorkspace(
    accountId: string,
    workspaceId: string,
    approvedByDeviceId: string,
    now = new Date(),
  ): Promise<void> {
    await this.requireActive(accountId, approvedByDeviceId);
    const existing = await this.pool.query<{ device_id: string }>(
      `SELECT device_id FROM sync_workspace_approvals WHERE account_id=$1 AND workspace_id=$2`,
      [accountId, workspaceId],
    );

    if (existing.rowCount && existing.rows[0].device_id !== approvedByDeviceId)
      throw new DeviceIdentityError('Workspace already has a single-device approval.');

    await this.pool.query(
      `INSERT INTO sync_workspace_approvals (account_id, workspace_id, device_id, approved_at) VALUES ($1,$2,$3,$4) ON CONFLICT (account_id,workspace_id) DO UPDATE SET device_id=EXCLUDED.device_id, approved_at=EXCLUDED.approved_at`,
      [accountId, workspaceId, approvedByDeviceId, now],
    );
    await this.audit(accountId, approvedByDeviceId, 'approved', workspaceId, now);
  }

  async enrollDevice(
    accountId: string,
    deviceId: string,
    workspaceId: string,
    approverDeviceId: string,
    input: unknown,
    now = new Date(),
    allowRevokedApprover = false,
  ): Promise<Grant> {
    const envelope = parseEncryptedEnvelope(input);

    await this.requireActive(accountId, deviceId);
    if (allowRevokedApprover) await this.requireDevice(accountId, approverDeviceId);
    else await this.requireActive(accountId, approverDeviceId);
    if (
      envelope.kind !== 'sync-object' ||
      envelope.workspaceId !== workspaceId ||
      envelope.recordType !== 'workspace-key-distribution' ||
      envelope.metadata['recipientDeviceId'] !== deviceId
    )
      throw new DeviceIdentityError('Workspace key envelope is not addressed to this device.');
    const client = await this.pool.connect();
    const key = `device-grants/${accountId}/${workspaceId}/${deviceId}/${randomUUID()}`;
    const body = Buffer.from(serializeEncryptedEnvelope(envelope));

    try {
      await client.query('BEGIN');
      const approval = await client.query(
        `
          SELECT 1
          FROM sync_workspace_approvals
          WHERE account_id=$1 AND workspace_id=$2 AND device_id=$3
          UNION ALL
          SELECT 1
          FROM sync_device_grants
          WHERE account_id=$1 AND workspace_id=$2 AND device_id=$3 AND revoked_at IS NULL
          UNION ALL
          SELECT 1
          FROM sync_device_audit
          WHERE account_id=$1 AND workspace_id=$2 AND device_id=$3
            AND kind IN ('enrolled', 'approved')
            AND $4 = true
        `,
        [accountId, workspaceId, approverDeviceId, allowRevokedApprover],
      );

      if (!approval.rowCount) throw new DeviceIdentityError('Enrollment requires workspace-scoped approval.');
      const existing = await client.query(
        `SELECT 1 FROM sync_device_grants WHERE account_id=$1 AND workspace_id=$2 AND device_id=$3`,
        [accountId, workspaceId, deviceId],
      );

      if (existing.rowCount) throw new DeviceIdentityError('Device is already enrolled for this workspace.');
      const version = Number(
        (
          await client.query(
            `INSERT INTO sync_workspace_versions (account_id, workspace_id, version) VALUES ($1,$2,1) ON CONFLICT (account_id,workspace_id) DO UPDATE SET version=sync_workspace_versions.version+1 RETURNING version`,
            [accountId, workspaceId],
          )
        ).rows[0].version,
      );

      await this.objects.put(key, body);
      await client.query(
        `INSERT INTO sync_device_grants (account_id,workspace_id,device_id,enrollment_version,object_key,ciphertext_sha256,enrolled_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [accountId, workspaceId, deviceId, version, key, sha256(body), now],
      );
      await client.query('COMMIT');
      await this.audit(accountId, deviceId, 'enrolled', workspaceId, now);

      return {
        deviceId,
        enrolledAt: now.toISOString(),
        enrollmentVersion: version,
        keyEnvelope: envelope,
        workspaceId,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      await this.objects.delete(key).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeDevice(accountId: string, deviceId: string, now = new Date(), workspaceId?: string): Promise<void> {
    await this.requireDevice(accountId, deviceId);
    await this.pool.query(
      `UPDATE sync_devices SET status='revoked', revoked_at=$3 WHERE account_id=$1 AND device_id=$2 AND status='active'`,
      [accountId, deviceId, now],
    );
    const grantRevocation = workspaceId
      ? {
          query: `UPDATE sync_device_grants SET revoked_at=$4 WHERE account_id=$1 AND device_id=$2 AND workspace_id=$3 AND revoked_at IS NULL`,
          values: [accountId, deviceId, workspaceId, now],
        }
      : {
          query: `UPDATE sync_device_grants SET revoked_at=$3 WHERE account_id=$1 AND device_id=$2 AND revoked_at IS NULL`,
          values: [accountId, deviceId, now],
        };

    await this.pool.query(grantRevocation.query, grantRevocation.values);
    await this.audit(accountId, deviceId, 'revoked', workspaceId, now);
  }

  async authorizeSync(accountId: string, deviceId: string, workspaceId: string, version: number): Promise<Grant> {
    const grant = await this.getGrant(accountId, deviceId, workspaceId);
    const device = await this.requireActive(accountId, deviceId);

    if (!device || !grant || grant.enrollmentVersion !== version)
      throw new DeviceIdentityError('Device authorization is revoked or stale.');

    return grant;
  }
  async authorizeLocalAgent(accountId: string, deviceId: string, workspaceId: string): Promise<Grant> {
    return this.authorizeSync(
      accountId,
      deviceId,
      workspaceId,
      (await this.getGrant(accountId, deviceId, workspaceId))?.enrollmentVersion ?? -1,
    );
  }
  async recoverDevice(
    accountId: string,
    lost: string,
    replacement: string,
    workspaceId: string,
    approver: string,
    input: unknown,
    now = new Date(),
    recoveryApproverDeviceIds: string[] = [approver],
    allDeviceLoss = false,
  ): Promise<Grant> {
    await this.requireDevice(accountId, replacement);
    const uniqueApprovers = [...new Set(recoveryApproverDeviceIds)];

    if (uniqueApprovers.length < 2) throw new DeviceIdentityError('Recovery requires a quorum of two devices.');
    for (const approverDeviceId of uniqueApprovers) {
      const device = await this.requireDevice(accountId, approverDeviceId);
      const grant = await this.getGrant(accountId, approverDeviceId, workspaceId);

      if (allDeviceLoss) {
        const priorEnrollment = await this.pool.query(
          `SELECT 1 FROM sync_device_audit WHERE account_id=$1 AND workspace_id=$2 AND device_id=$3 AND kind IN ('enrolled','approved') LIMIT 1`,
          [accountId, workspaceId, approverDeviceId],
        );

        if (device.status !== 'revoked' || !priorEnrollment.rowCount) {
          throw new DeviceIdentityError('Recovery quorum is not authorized for this workspace.');
        }
      } else if (
        device.status !== 'active' ||
        (!grant && !(await this.hasWorkspaceApproval(accountId, workspaceId, approverDeviceId)))
      ) {
        throw new DeviceIdentityError('Recovery quorum is not authorized for this workspace.');
      }
    }
    await this.revokeDevice(accountId, lost, now, workspaceId);
    const grant = await this.enrollDevice(accountId, replacement, workspaceId, approver, input, now, allDeviceLoss);

    await this.audit(accountId, replacement, 'recovered', workspaceId, now);

    return grant;
  }
  async auditEvents(accountId: string): Promise<DeviceAuditEvent[]> {
    const rows = await this.pool.query<Record<string, unknown>>(
      `SELECT account_id AS "accountId", at, device_id AS "deviceId", kind, workspace_id AS "workspaceId" FROM sync_device_audit WHERE account_id=$1 ORDER BY at`,
      [accountId],
    );

    return rows.rows.map((row) => ({ ...row, at: new Date(row['at'] as string).toISOString() }) as DeviceAuditEvent);
  }

  private async requireDevice(accountId: string, deviceId: string): Promise<DeviceIdentity> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT account_id AS "accountId", created_at AS "createdAt", device_id AS "deviceId", fingerprint, label, public_key AS "publicKey", revoked_at AS "revokedAt", status FROM sync_devices WHERE account_id=$1 AND device_id=$2`,
      [accountId, deviceId],
    );

    if (!result.rowCount) throw new DeviceIdentityError('Device was not found.');

    return result.rows[0] as DeviceIdentity;
  }
  private async requireActive(accountId: string, deviceId: string): Promise<DeviceIdentity> {
    const device = await this.requireDevice(accountId, deviceId);

    if (device.status !== 'active') throw new DeviceIdentityError('Device authorization is revoked or stale.');

    return device;
  }
  private async getGrant(accountId: string, deviceId: string, workspaceId: string): Promise<Grant | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT enrollment_version AS "enrollmentVersion", enrolled_at AS "enrolledAt", object_key AS "objectKey" FROM sync_device_grants WHERE account_id=$1 AND workspace_id=$2 AND device_id=$3 AND revoked_at IS NULL`,
      [accountId, workspaceId, deviceId],
    );

    if (!result.rowCount) return undefined;
    const row = result.rows[0];
    const body = await this.objects.get(row['objectKey'] as string);

    if (!body) throw new DeviceIdentityError('Device key envelope is unavailable.');

    return {
      deviceId,
      enrolledAt: new Date(row['enrolledAt'] as string).toISOString(),
      enrollmentVersion: Number(row['enrollmentVersion']),
      keyEnvelope: deserializeEncryptedEnvelope(new TextDecoder().decode(body)),
      workspaceId,
    };
  }

  private async hasWorkspaceApproval(accountId: string, workspaceId: string, deviceId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM sync_workspace_approvals WHERE account_id=$1 AND workspace_id=$2 AND device_id=$3 LIMIT 1`,
      [accountId, workspaceId, deviceId],
    );

    return Boolean(result.rowCount);
  }
  private async audit(
    accountId: string,
    deviceId: string,
    kind: DeviceAuditEvent['kind'],
    workspaceId: string | undefined,
    at: Date,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO sync_device_audit (account_id,device_id,kind,workspace_id,at) VALUES ($1,$2,$3,$4,$5)`,
      [accountId, deviceId, kind, workspaceId ?? null, at],
    );
  }
}

let configured: DurableDeviceIdentityStore | undefined;

function getConfiguredDeviceIdentityStore(): DurableDeviceIdentityStore {
  if (!env.OPAQUE_SYNC_S3_ENDPOINT || !env.OPAQUE_SYNC_S3_ACCESS_KEY || !env.OPAQUE_SYNC_S3_SECRET_KEY)
    throw new Error('Durable device storage is missing object-store configuration.');
  configured ??= DurableDeviceIdentityStore.fromConfig(getPool(), {
    endpoint: env.OPAQUE_SYNC_S3_ENDPOINT,
    bucket: env.OPAQUE_SYNC_S3_BUCKET,
    accessKey: env.OPAQUE_SYNC_S3_ACCESS_KEY,
    secretKey: env.OPAQUE_SYNC_S3_SECRET_KEY,
  });

  return configured;
}

export { getConfiguredDeviceIdentityStore };
