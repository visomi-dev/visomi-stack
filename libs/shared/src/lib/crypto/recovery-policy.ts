export type RecoveryApproval = Readonly<{ actorId: string; deviceId: string; approvedAt: string }>;

export type RecoveryDecision =
  | { allowed: true; reason: 'quorum-met' }
  | { allowed: false; reason: 'insufficient-quorum' | 'duplicate-approver' | 'revoked-approver' | 'invalid-request' };

export type RecoveryRequest = Readonly<{
  workspaceId: string;
  replacementDeviceId: string;
  approvals: readonly RecoveryApproval[];
  revokedDeviceIds: ReadonlySet<string>;
  quorum: number;
  consentId: string;
}>;

/** Fail-closed recovery gate. Key rotation and deletion happen after this gate. */
export function evaluateRecovery(request: RecoveryRequest): RecoveryDecision {
  if (!request.workspaceId || !request.replacementDeviceId || !request.consentId || request.quorum < 1) {
    return { allowed: false, reason: 'invalid-request' };
  }

  const devices = new Set<string>();

  for (const approval of request.approvals) {
    if (request.revokedDeviceIds.has(approval.deviceId)) return { allowed: false, reason: 'revoked-approver' };
    if (devices.has(approval.deviceId)) return { allowed: false, reason: 'duplicate-approver' };
    devices.add(approval.deviceId);
  }

  return devices.size >= request.quorum
    ? { allowed: true, reason: 'quorum-met' }
    : { allowed: false, reason: 'insufficient-quorum' };
}
