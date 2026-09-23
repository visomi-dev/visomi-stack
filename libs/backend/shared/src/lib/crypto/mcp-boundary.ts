import { CapabilityPolicy, type Capability, type CapabilityRequest } from './capability-policy';
import { type LocalAgentContextAuthority, type VerifiedLocalAgentContext } from './local-agent-context';

export type McpToolDefinition = {
  name: string;
  execute: (input: unknown) => {
    dataClass: 'public' | 'internal' | 'protected-plaintext' | 'secret';
    result: unknown;
  };
};

export type McpRequest = {
  requestId: string;
  context: VerifiedLocalAgentContext;
  tool: string;
  input: unknown;
  capability: Capability;
  capabilityRequest: CapabilityRequest;
  state: 'ready' | 'locked' | 'revoked' | 'expired';
};

export type McpAuditEvent = {
  requestId: string;
  caller: string;
  accountId: string;
  workspaceId: string;
  deviceId: string;
  tool: string;
  decision: 'allowed' | 'denied';
  reason: string;
};

export type McpDecision =
  | { allowed: true; result: unknown }
  | {
      allowed: false;
      reason:
        | 'unauthenticated'
        | 'device-unauthorized'
        | 'locked'
        | 'revoked'
        | 'expired'
        | 'unknown-tool'
        | 'boundary-denied'
        | 'secret-result-denied'
        | 'protected-result-denied';
    };

type McpDenyReason = Extract<McpDecision, { allowed: false }>['reason'];

/** A bounded MCP seam. Tool output is data, never authority. */
export class McpBoundary {
  private readonly tools: ReadonlyMap<string, McpToolDefinition>;
  private readonly audit: McpAuditEvent[] = [];

  public constructor(
    toolDefinitions: readonly McpToolDefinition[],
    private readonly contextAuthority: LocalAgentContextAuthority,
    private readonly capabilityPolicy = new CapabilityPolicy(),
  ) {
    this.tools = new Map(toolDefinitions.map((tool) => [tool.name, tool]));
  }

  public getAuditEvents(): readonly McpAuditEvent[] {
    return this.audit;
  }

  public revokeCapability(capabilityId: string): void {
    this.capabilityPolicy.revoke(capabilityId);
  }

  public invoke(request: McpRequest): McpDecision {
    const deny = (reason: McpDenyReason): McpDecision => {
      this.audit.push({
        accountId: request.context.accountId,
        caller: request.context.principal,
        decision: 'denied',
        deviceId: request.context.deviceId,
        reason,
        requestId: request.requestId,
        tool: request.tool,
        workspaceId: request.context.workspaceId,
      });

      return { allowed: false, reason };
    };

    if (!this.contextAuthority.verify(request.context)) return deny('device-unauthorized');
    // Lock state belongs to the local agent, not to the transport payload.
    if (this.contextAuthority.isLocked()) return deny('locked');
    const tool = this.tools.get(request.tool);

    if (!tool) return deny('unknown-tool');

    const capabilityDecision = this.capabilityPolicy.evaluate(request.capability, {
      ...request.capabilityRequest,
      audience: `mcp:${request.tool}`,
      caller: request.context.principal,
      requestId: request.requestId,
      scope: {
        accountId: request.context.accountId,
        action: 'execute',
        resourceId: request.tool,
        workspaceId: request.context.workspaceId,
      },
    });

    if (!capabilityDecision.allowed) {
      if (capabilityDecision.reason === 'revoked') return deny('revoked');

      return deny('boundary-denied');
    }

    const output = tool.execute(request.input);

    if (output.dataClass === 'secret') return deny('secret-result-denied');
    if (output.dataClass === 'protected-plaintext') return deny('protected-result-denied');

    this.audit.push({
      accountId: request.context.accountId,
      caller: request.context.principal,
      decision: 'allowed',
      deviceId: request.context.deviceId,
      reason: 'capability-allow',
      requestId: request.requestId,
      tool: request.tool,
      workspaceId: request.context.workspaceId,
    });

    return { allowed: true, result: output.result };
  }
}
