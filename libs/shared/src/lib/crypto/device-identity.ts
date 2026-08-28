import { createHash, randomBytes } from 'node:crypto';

import { parseEncryptedEnvelope, type EncryptedEnvelope } from './encrypted-envelope';

export type DeviceStatus = 'active' | 'revoked';

export type DeviceIdentity = {
  accountId: string;
  createdAt: string;
  deviceId: string;
  fingerprint: string;
  label: string;
  publicKey: string;
  revokedAt?: string;
  status: DeviceStatus;
};

export type DeviceAuditEvent = {
  accountId: string;
  at: string;
  deviceId: string;
  kind: 'created' | 'enrolled' | 'revoked' | 'recovered' | 'approved';
  workspaceId?: string;
};

type WorkspaceGrant = {
  deviceId: string;
  enrolledAt: string;
  enrollmentVersion: number;
  keyEnvelope: EncryptedEnvelope;
  workspaceId: string;
};

type WorkspaceApproval = {
  accountId: string;
  approvedByDeviceId: string;
  workspaceId: string;
};

export class DeviceIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceIdentityError';
  }
}

/**
 * Holds cloud-visible device metadata and opaque workspace-key envelopes.
 * It never accepts a VMK, private key, or decrypts an envelope.
 */
export class DeviceIdentityStore {
  private readonly devices = new Map<string, DeviceIdentity>();
  private readonly grants = new Map<string, WorkspaceGrant>();
  private readonly workspaceVersions = new Map<string, number>();
  private readonly workspaceApprovals = new Map<string, WorkspaceApproval>();
  private readonly workspaceAuthorizations = new Set<string>();
  private readonly audit: DeviceAuditEvent[] = [];

  createIdentity(
    accountId: string,
    publicKey: string,
    label = 'Unnamed device',
    now = new Date(),
    workspaceId?: string,
  ): DeviceIdentity {
    if (!accountId || !publicKey || !label) {
      throw new DeviceIdentityError('Account, public key, and label are required.');
    }
    const fingerprint = createHash('sha256').update(publicKey).digest('base64url');

    if (
      [...this.devices.values()].some((device) => device.accountId === accountId && device.fingerprint === fingerprint)
    ) {
      throw new DeviceIdentityError('Device identity already exists for this account.');
    }
    const deviceId = `device-${randomBytes(12).toString('base64url')}`;
    const identity: DeviceIdentity = {
      accountId,
      createdAt: now.toISOString(),
      deviceId,
      fingerprint,
      label,
      publicKey,
      status: 'active',
    };

    this.devices.set(deviceId, identity);
    if (workspaceId) this.workspaceAuthorizations.add(this.workspaceDeviceKey(accountId, workspaceId, deviceId));
    this.audit.push({ accountId, at: identity.createdAt, deviceId, kind: 'created', workspaceId });

    return { ...identity };
  }

  enrollDevice(
    accountId: string,
    deviceId: string,
    workspaceId: string,
    approvedByDeviceId: string,
    keyEnvelopeInput: unknown,
    now = new Date(),
    allowRevokedApprover = false,
  ): WorkspaceGrant {
    const device = this.requireDevice(accountId, deviceId);
    const approver = this.requireDevice(accountId, approvedByDeviceId);

    if (approver.status !== 'active' && !allowRevokedApprover) {
      throw new DeviceIdentityError('A revoked device cannot approve enrollment.');
    }
    if (device.status !== 'active') {
      throw new DeviceIdentityError('A revoked device cannot be enrolled.');
    }
    if (!this.workspaceApprovals.has(this.workspaceKey(accountId, workspaceId))) {
      throw new DeviceIdentityError('Enrollment requires workspace-scoped approval.');
    }
    const keyEnvelope = parseEncryptedEnvelope(keyEnvelopeInput);

    if (
      keyEnvelope.kind !== 'sync-object' ||
      keyEnvelope.workspaceId !== workspaceId ||
      keyEnvelope.recordType !== 'workspace-key-distribution' ||
      keyEnvelope.metadata['recipientDeviceId'] !== deviceId
    ) {
      throw new DeviceIdentityError('Workspace key envelope is not addressed to this device.');
    }
    const key = this.grantKey(accountId, workspaceId, deviceId);

    if (this.grants.has(key)) {
      throw new DeviceIdentityError('Device is already enrolled for this workspace.');
    }
    const version = (this.workspaceVersions.get(`${accountId}\u0000${workspaceId}`) ?? 0) + 1;

    this.workspaceVersions.set(`${accountId}\u0000${workspaceId}`, version);
    const grant = { deviceId, enrolledAt: now.toISOString(), enrollmentVersion: version, keyEnvelope, workspaceId };

    this.grants.set(key, grant);
    this.audit.push({ accountId, at: grant.enrolledAt, deviceId, kind: 'enrolled', workspaceId });

    return { ...grant };
  }

  approveWorkspace(accountId: string, workspaceId: string, approvedByDeviceId: string, now = new Date()): void {
    const approver = this.requireDevice(accountId, approvedByDeviceId);

    if (approver.status !== 'active') throw new DeviceIdentityError('A revoked device cannot approve enrollment.');
    if (!this.workspaceAuthorizations.has(this.workspaceDeviceKey(accountId, workspaceId, approvedByDeviceId))) {
      throw new DeviceIdentityError('Approver is not authorized for this workspace.');
    }
    const key = this.workspaceKey(accountId, workspaceId);
    const existing = this.workspaceApprovals.get(key);

    if (existing && existing.approvedByDeviceId !== approvedByDeviceId) {
      throw new DeviceIdentityError('Workspace already has a single-device approval.');
    }
    this.workspaceApprovals.set(key, {
      accountId,
      approvedByDeviceId,
      workspaceId,
    });
    this.audit.push({ accountId, at: now.toISOString(), deviceId: approvedByDeviceId, kind: 'approved', workspaceId });
  }

  listDevices(accountId: string): DeviceIdentity[] {
    return [...this.devices.values()]
      .filter((device) => device.accountId === accountId)
      .map((device) => ({ ...device }));
  }

  revokeDevice(accountId: string, deviceId: string, now = new Date(), workspaceId?: string): void {
    const device = this.requireDevice(accountId, deviceId);

    if (device.status === 'revoked') return;
    device.status = 'revoked';
    device.revokedAt = now.toISOString();
    for (const [key, grant] of this.grants) {
      if (grant.deviceId === deviceId && key.startsWith(`${accountId}\u0000`)) this.grants.delete(key);
    }
    this.audit.push({ accountId, at: device.revokedAt, deviceId, kind: 'revoked', workspaceId });
  }

  authorizeSync(accountId: string, deviceId: string, workspaceId: string, enrollmentVersion: number): WorkspaceGrant {
    const device = this.requireDevice(accountId, deviceId);
    const grant = this.grants.get(this.grantKey(accountId, workspaceId, deviceId));

    if (device.status !== 'active' || !grant || enrollmentVersion !== grant.enrollmentVersion) {
      throw new DeviceIdentityError('Device authorization is revoked or stale.');
    }

    return { ...grant };
  }

  authorizeLocalAgent(accountId: string, deviceId: string, workspaceId: string): WorkspaceGrant {
    const device = this.requireDevice(accountId, deviceId);
    const grant = this.grants.get(this.grantKey(accountId, workspaceId, deviceId));

    if (device.status !== 'active' || !grant) {
      throw new DeviceIdentityError('Device is not enrolled for this workspace.');
    }

    return { ...grant };
  }

  recoverDevice(
    accountId: string,
    lostDeviceId: string,
    replacementDeviceId: string,
    workspaceId: string,
    approvedByDeviceId: string,
    keyEnvelopeInput: unknown,
    now = new Date(),
    recoveryApproverDeviceIds: string[] = [approvedByDeviceId],
    allDeviceLoss = false,
  ): WorkspaceGrant {
    this.requireDevice(accountId, replacementDeviceId);
    this.requireRecoveryQuorum(accountId, workspaceId, recoveryApproverDeviceIds, allDeviceLoss);
    this.revokeDevice(accountId, lostDeviceId, now, workspaceId);
    const grant = this.enrollDevice(
      accountId,
      replacementDeviceId,
      workspaceId,
      approvedByDeviceId,
      keyEnvelopeInput,
      now,
      allDeviceLoss,
    );

    this.audit.push({
      accountId,
      at: now.toISOString(),
      deviceId: replacementDeviceId,
      kind: 'recovered',
      workspaceId,
    });

    return grant;
  }

  private requireRecoveryQuorum(
    accountId: string,
    workspaceId: string,
    approverDeviceIds: string[],
    allDeviceLoss: boolean,
  ): void {
    const uniqueApprovers = [...new Set(approverDeviceIds)];

    if (uniqueApprovers.length < 2) throw new DeviceIdentityError('Recovery requires a quorum of two devices.');

    for (const deviceId of uniqueApprovers) {
      const device = this.requireDevice(accountId, deviceId);
      const enrolled = this.grants.has(this.grantKey(accountId, workspaceId, deviceId));
      const previouslyEnrolled = this.audit.some(
        (event) =>
          (event.accountId === accountId &&
            event.workspaceId === workspaceId &&
            event.deviceId === deviceId &&
            event.kind === 'enrolled') ||
          event.kind === 'approved',
      );

      if (
        allDeviceLoss
          ? !previouslyEnrolled || device.status !== 'revoked'
          : device.status !== 'active' ||
            (!enrolled && !this.workspaceAuthorizations.has(this.workspaceDeviceKey(accountId, workspaceId, deviceId)))
      ) {
        throw new DeviceIdentityError('Recovery quorum is not authorized for this workspace.');
      }
    }
  }

  auditEvents(accountId: string): DeviceAuditEvent[] {
    return this.audit.filter((event) => event.accountId === accountId).map((event) => ({ ...event }));
  }

  clear(): void {
    this.devices.clear();
    this.grants.clear();
    this.workspaceVersions.clear();
    this.workspaceApprovals.clear();
    this.workspaceAuthorizations.clear();
    this.audit.length = 0;
  }

  private requireDevice(accountId: string, deviceId: string): DeviceIdentity {
    const device = this.devices.get(deviceId);

    if (!device || device.accountId !== accountId) throw new DeviceIdentityError('Device was not found.');

    return device;
  }

  private grantKey(accountId: string, workspaceId: string, deviceId: string): string {
    return `${accountId}\u0000${workspaceId}\u0000${deviceId}`;
  }

  private workspaceKey(accountId: string, workspaceId: string): string {
    return `${accountId}\u0000${workspaceId}`;
  }

  private workspaceDeviceKey(accountId: string, workspaceId: string, deviceId: string): string {
    return `${accountId}\u0000${workspaceId}\u0000${deviceId}`;
  }
}

const deviceIdentityStore = new DeviceIdentityStore();

export { deviceIdentityStore };
