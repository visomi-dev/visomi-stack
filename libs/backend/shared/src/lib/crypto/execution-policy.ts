import { resolve } from 'node:path';

import { CapabilityPolicy, type Capability, type CapabilityRequest } from './capability-policy';

export type ExecutionTrustProfile = 'local-only' | 'external-redacted' | 'external-plaintext-approved';

export type ExecutionState = 'ready' | 'locked' | 'offline' | 'degraded' | 'revoked' | 'recovery';

export type ExecutionAction =
  | 'read-filesystem'
  | 'write-filesystem'
  | 'execute-command'
  | 'network'
  | 'use-secret'
  | 'send-external-ai'
  | 'recover';

export type ExecutionDataClass = 'public' | 'internal' | 'protected-plaintext' | 'secret';

export type ExecutionRequest = {
  action: ExecutionAction;
  dataClass: ExecutionDataClass;
  profile: ExecutionTrustProfile;
  state: ExecutionState;
  path?: string;
  networkHost?: string;
  consent?: boolean;
  secretBroker?: boolean;
  capability?: Capability;
  capabilityRequest?: CapabilityRequest;
  provider?: string;
  projectionId?: string;
  projectedFields?: readonly string[];
  retentionDays?: number;
  consentId?: string;
  outputValidated?: boolean;
};

export type ExecutionDecision =
  | { allowed: true; reason: 'policy-allow' | 'broker-allow' | 'recovery-allow' }
  | { allowed: false; reason: ExecutionDenyReason }
  | { allowed: false; reason: 'approval-required' };

export type ExecutionDenyReason =
  | 'locked'
  | 'revoked'
  | 'offline-network'
  | 'offline-external-ai'
  | 'degraded-operation'
  | 'recovery-only'
  | 'profile-denies-external-ai'
  | 'protected-data-denied'
  | 'secret-broker-required'
  | 'filesystem-boundary'
  | 'network-boundary'
  | 'capability-required'
  | 'capability-denied';

const isUnderRoot = (path: string | undefined, root: string): boolean => {
  if (path === undefined) return false;

  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);

  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}/`);
};

/**
 * Fail-closed policy at the local execution boundary. This is an executable
 * policy seam, not a sandbox or a cryptographic capability implementation.
 */
export class ExecutionPolicy {
  public constructor(
    private readonly capabilityPolicy = new CapabilityPolicy(),
    private readonly filesystemRoot = '/workspace',
    private readonly networkHosts: ReadonlySet<string> = new Set(),
  ) {}

  public evaluate(request: ExecutionRequest): ExecutionDecision {
    if (request.state === 'revoked') return { allowed: false, reason: 'revoked' };
    if (request.state === 'locked' && request.action !== 'recover') {
      return { allowed: false, reason: 'locked' };
    }
    if (request.state === 'recovery' && request.action !== 'recover') {
      return { allowed: false, reason: 'recovery-only' };
    }
    if (request.action === 'recover') {
      return request.state === 'recovery' && request.consent === true
        ? { allowed: true, reason: 'recovery-allow' }
        : { allowed: false, reason: 'approval-required' };
    }

    if (request.state === 'offline' && request.action === 'network') {
      return { allowed: false, reason: 'offline-network' };
    }
    if (request.state === 'offline' && request.action === 'send-external-ai') {
      return { allowed: false, reason: 'offline-external-ai' };
    }
    if (request.state === 'degraded' && ['use-secret', 'network', 'send-external-ai'].includes(request.action)) {
      return { allowed: false, reason: 'degraded-operation' };
    }
    if (
      request.action === 'read-filesystem' ||
      request.action === 'write-filesystem' ||
      request.action === 'execute-command'
    ) {
      if (!isUnderRoot(request.path, this.filesystemRoot)) {
        return { allowed: false, reason: 'filesystem-boundary' };
      }
    }
    if (request.action === 'network' && (!request.networkHost || !this.networkHosts.has(request.networkHost))) {
      return { allowed: false, reason: 'network-boundary' };
    }
    if (request.action === 'use-secret') {
      if (request.dataClass !== 'secret' || request.secretBroker !== true) {
        return { allowed: false, reason: 'secret-broker-required' };
      }

      return this.evaluateCapability(request, 'broker-allow');
    }
    if (request.action === 'send-external-ai') {
      if (request.profile === 'local-only') {
        return { allowed: false, reason: 'profile-denies-external-ai' };
      }
      if (
        request.dataClass === 'secret' ||
        (request.dataClass === 'protected-plaintext' && request.profile !== 'external-plaintext-approved')
      ) {
        return { allowed: false, reason: 'protected-data-denied' };
      }

      if (
        !request.provider ||
        !request.projectionId ||
        !request.consentId ||
        !request.projectedFields?.length ||
        request.retentionDays === undefined ||
        request.retentionDays < 0 ||
        request.outputValidated !== true
      ) {
        return { allowed: false, reason: 'approval-required' };
      }

      return request.consent === true
        ? this.evaluateCapability(request, 'policy-allow')
        : { allowed: false, reason: 'approval-required' };
    }

    return this.evaluateCapability(request, 'policy-allow');
  }

  private evaluateCapability(
    request: ExecutionRequest,
    allowedReason: 'policy-allow' | 'broker-allow',
  ): ExecutionDecision {
    if (!request.capability || !request.capabilityRequest) {
      return { allowed: false, reason: 'capability-required' };
    }
    const decision = this.capabilityPolicy.evaluate(request.capability, request.capabilityRequest);

    return decision.allowed
      ? { allowed: true, reason: allowedReason }
      : { allowed: false, reason: 'capability-denied' };
  }
}
