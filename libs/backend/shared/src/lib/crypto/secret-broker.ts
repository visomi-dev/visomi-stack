import { CapabilityPolicy, type Capability, type CapabilityRequest } from './capability-policy';
import { type LocalAgentContextAuthority, type VerifiedLocalAgentContext } from './local-agent-context';

export type SecretOperation = 'metadata';

export type SecretBrokerRequest = {
  requestId: string;
  context: VerifiedLocalAgentContext;
  secretId: string;
  operation: SecretOperation;
  purpose: string;
  consent: boolean;
  capability: Capability;
  capabilityRequest: CapabilityRequest;
  at?: Date;
};

export type SecretBrokerResult = {
  secretId: string;
  operation: SecretOperation;
  available: boolean;
};

export type SecretBrokerAuditEvent = {
  requestId: string;
  secretId: string;
  accountId: string;
  workspaceId: string;
  caller: string;
  operation: SecretOperation;
  decision: 'allowed' | 'denied';
  reason: string;
};

type SecretRecord = {
  accountId: string;
  workspaceId: string;
  value: string;
};

export type SecretBrokerDecision =
  | { allowed: true; result: SecretBrokerResult }
  | { allowed: false; reason: 'locked' | 'consent-required' | 'not-found' | 'boundary-denied' };

type SecretBrokerDenyReason = Extract<SecretBrokerDecision, { allowed: false }>['reason'];

/**
 * The local-only secret authority. It deliberately has no operation that
 * returns a secret value; callers receive a minimal operation result instead.
 */
export class SecretBroker {
  private readonly secrets = new Map<string, SecretRecord>();
  private readonly audit: SecretBrokerAuditEvent[] = [];

  public constructor(
    private readonly contextAuthority: LocalAgentContextAuthority,
    private readonly capabilityPolicy = new CapabilityPolicy(),
  ) {}

  public register(secretId: string, value: string, accountId: string, workspaceId: string): void {
    this.secrets.set(secretId, { accountId, value, workspaceId });
  }

  public lock(): void {
    this.contextAuthority.lock();
  }

  public unlock(): void {
    this.contextAuthority.unlock();
  }

  public revokeCapability(capabilityId: string): void {
    this.capabilityPolicy.revoke(capabilityId);
  }

  public getAuditEvents(): readonly SecretBrokerAuditEvent[] {
    return this.audit;
  }

  public execute(request: SecretBrokerRequest): SecretBrokerDecision {
    const record = this.secrets.get(request.secretId);
    const deny = (reason: SecretBrokerDenyReason): SecretBrokerDecision => {
      this.audit.push({
        accountId: request.context.accountId,
        caller: request.context.principal,
        decision: 'denied',
        operation: request.operation,
        reason,
        requestId: request.requestId,
        secretId: request.secretId,
        workspaceId: request.context.workspaceId,
      });

      return { allowed: false, reason };
    };

    if (!this.contextAuthority.verify(request.context)) return deny('boundary-denied');
    if (this.contextAuthority.isLocked()) return deny('locked');
    if (!request.consent) return deny('consent-required');
    if (
      !record ||
      record.accountId !== request.context.accountId ||
      record.workspaceId !== request.context.workspaceId
    ) {
      return deny('not-found');
    }

    const capabilityDecision = this.capabilityPolicy.evaluate(request.capability, {
      ...request.capabilityRequest,
      at: request.at ?? request.capabilityRequest.at,
      caller: request.context.principal,
      purpose: request.purpose,
      requestId: request.requestId,
      scope: {
        accountId: request.context.accountId,
        action: 'use-secret',
        resourceId: request.secretId,
        workspaceId: request.context.workspaceId,
      },
    });

    if (!capabilityDecision.allowed) return deny('boundary-denied');

    // Keep the value live only within the broker boundary. It is intentionally
    // referenced to make the non-exporting contract explicit to implementers.
    void record.value;
    const result = { available: true, operation: request.operation, secretId: request.secretId };

    this.audit.push({
      accountId: request.context.accountId,
      caller: request.context.principal,
      decision: 'allowed',
      operation: request.operation,
      reason: 'capability-allow',
      requestId: request.requestId,
      secretId: request.secretId,
      workspaceId: request.context.workspaceId,
    });

    return { allowed: true, result };
  }
}
