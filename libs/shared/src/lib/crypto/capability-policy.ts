import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

import type { CapabilityIssuerKeyRegistry } from './capability-issuer';

export type CapabilityAudience = 'local-agent' | `mcp:${string}`;

export type CapabilityAction = 'read' | 'write' | 'execute' | 'use-secret' | 'delegate';

export type CapabilityScope = {
  accountId: string;
  workspaceId: string;
  projectId?: string;
  resourceId?: string;
  action: CapabilityAction;
};

export type Capability = {
  format: 'themis.capability';
  version: 1;
  id: string;
  issuer: 'local-agent';
  subject: string;
  audience: CapabilityAudience;
  scope: CapabilityScope;
  purpose: string;
  issuedAt: string;
  expiresAt: string;
  delegable: boolean;
  signature: string;
  issuerPublicKey?: string;
  issuerKeyId?: string;
};

export type CapabilityRequest = {
  requestId: string;
  caller: string;
  audience: CapabilityAudience;
  scope: CapabilityScope;
  purpose: string;
  at?: Date;
};

export type CapabilityStatePersistence = {
  load: () => { revoked: readonly string[]; requests: readonly string[] };
  save: (state: { revoked: readonly string[]; requests: readonly string[] }) => void;
};

export type CapabilityDecision =
  | { allowed: true; capabilityId: string }
  | {
      allowed: false;
      reason:
        | 'malformed'
        | 'expired'
        | 'not-yet-valid'
        | 'revoked'
        | 'replayed'
        | 'subject-mismatch'
        | 'audience-mismatch'
        | 'purpose-mismatch'
        | 'scope-mismatch';
    };

function capabilityPayload(capability: Capability): string {
  const { signature: _signature, ...unsigned } = capability;

  return JSON.stringify(unsigned);
}

export function signCapability(
  capability: Capability,
  privateKey: KeyObject,
  issuerPublicKey: string,
  issuerKeyId = 'default',
): Capability {
  const unsigned = { ...capability, issuerKeyId, issuerPublicKey, signature: '' };

  return {
    ...unsigned,
    signature: sign(null, Buffer.from(capabilityPayload(unsigned)), privateKey).toString('base64url'),
  };
}

const sameScope = (capability: CapabilityScope, request: CapabilityScope): boolean =>
  capability.accountId === request.accountId &&
  capability.workspaceId === request.workspaceId &&
  capability.projectId === request.projectId &&
  capability.resourceId === request.resourceId &&
  capability.action === request.action;

function isCapability(value: unknown): value is Capability {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Capability>;
  const scope = candidate.scope;

  return (
    candidate.format === 'themis.capability' &&
    candidate.version === 1 &&
    candidate.issuer === 'local-agent' &&
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.subject === 'string' &&
    candidate.subject.length > 0 &&
    typeof candidate.audience === 'string' &&
    candidate.audience.length > 0 &&
    typeof candidate.purpose === 'string' &&
    candidate.purpose.length > 0 &&
    typeof candidate.signature === 'string' &&
    candidate.signature.length > 0 &&
    typeof candidate.issuerPublicKey === 'string' &&
    candidate.issuerPublicKey.length > 0 &&
    typeof candidate.issuedAt === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.issuedAt)) &&
    !Number.isNaN(Date.parse(candidate.expiresAt)) &&
    Date.parse(candidate.expiresAt) > Date.parse(candidate.issuedAt) &&
    !!scope &&
    typeof scope.accountId === 'string' &&
    typeof scope.workspaceId === 'string' &&
    scope.accountId.length > 0 &&
    scope.workspaceId.length > 0
  );
}

/**
 * Evaluates already-issued capabilities at the local trust boundary.
 * The cloud/MCP transport may carry a capability, but only the local agent
 * decides whether it can be used. Revocation and request IDs are process
 * state here; durable storage and cryptographic encoding remain open.
 */
export class CapabilityPolicy {
  private readonly revoked: Set<string>;
  private readonly requests: Set<string>;

  public constructor(
    private readonly persistence?: CapabilityStatePersistence,
    private readonly issuerKeys?: CapabilityIssuerKeyRegistry,
  ) {
    const state = persistence?.load();

    this.revoked = new Set(state?.revoked ?? []);
    this.requests = new Set(state?.requests ?? []);
  }

  private persist(): void {
    this.persistence?.save({ revoked: [...this.revoked], requests: [...this.requests] });
  }

  revoke(capabilityId: string): void {
    this.revoked.add(capabilityId);
    this.persist();
  }

  evaluate(capability: Capability, request: CapabilityRequest): CapabilityDecision {
    if (!isCapability(capability)) return { allowed: false, reason: 'malformed' };

    let signatureValid: boolean;

    try {
      const registeredKey = this.issuerKeys?.resolve(
        capability.issuer,
        capability.issuerKeyId ?? 'default',
        request.at,
      );

      if (this.issuerKeys && !registeredKey) return { allowed: false, reason: 'malformed' };
      signatureValid = verify(
        null,
        Buffer.from(capabilityPayload(capability)),
        createPublicKey({
          key: Buffer.from(capability.issuerPublicKey ?? '', 'base64url'),
          format: 'der',
          type: 'spki',
        }),
        Buffer.from(capability.signature, 'base64url'),
      );
      if (registeredKey) {
        signatureValid = verify(
          null,
          Buffer.from(capabilityPayload(capability)),
          registeredKey,
          Buffer.from(capability.signature, 'base64url'),
        );
      }
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) return { allowed: false, reason: 'malformed' };

    const now = (request.at ?? new Date()).getTime();
    const issuedAt = Date.parse(capability.issuedAt);
    const expiresAt = Date.parse(capability.expiresAt);

    if (now < issuedAt) return { allowed: false, reason: 'not-yet-valid' };

    if (now >= expiresAt) return { allowed: false, reason: 'expired' };

    if (this.revoked.has(capability.id)) return { allowed: false, reason: 'revoked' };

    if (this.requests.has(request.requestId)) return { allowed: false, reason: 'replayed' };

    if (capability.subject !== request.caller) return { allowed: false, reason: 'subject-mismatch' };

    if (capability.audience !== request.audience) return { allowed: false, reason: 'audience-mismatch' };

    if (capability.purpose !== request.purpose) return { allowed: false, reason: 'purpose-mismatch' };

    if (!sameScope(capability.scope, request.scope)) return { allowed: false, reason: 'scope-mismatch' };

    this.requests.add(request.requestId);
    this.persist();

    return { allowed: true, capabilityId: capability.id };
  }
}
