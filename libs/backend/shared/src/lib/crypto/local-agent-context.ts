import { randomBytes } from 'node:crypto';

import { type DeviceIdentityStore } from './device-identity';

export type VerifiedLocalAgentContext = Readonly<{
  accountId: string;
  deviceId: string;
  principal: string;
  sessionId: string;
  workspaceId: string;
}>;

/** Verifies enrolled device authority and issues process-local request context. */
export class LocalAgentContextAuthority {
  private readonly revokedSessions = new Set<string>();
  private readonly sessions = new Map<string, VerifiedLocalAgentContext>();
  private locked = false;

  public constructor(private readonly devices: DeviceIdentityStore) {}

  public authenticate(accountId: string, deviceId: string, workspaceId: string): VerifiedLocalAgentContext {
    const grant = this.devices.authorizeLocalAgent(accountId, deviceId, workspaceId);
    const context = Object.freeze({
      accountId,
      deviceId: grant.deviceId,
      principal: `local-agent:${accountId}:${grant.deviceId}`,
      sessionId: `agent-session-${randomBytes(16).toString('base64url')}`,
      workspaceId: grant.workspaceId,
    });

    this.sessions.set(context.sessionId, context);

    return context;
  }

  public revoke(context: VerifiedLocalAgentContext): void {
    this.revokedSessions.add(context.sessionId);
  }

  public lock(): void {
    this.locked = true;
  }

  public unlock(): void {
    this.locked = false;
  }

  public isLocked(): boolean {
    return this.locked;
  }

  public verify(context: VerifiedLocalAgentContext): boolean {
    const current = this.sessions.get(context.sessionId);

    if (!current || this.revokedSessions.has(context.sessionId)) return false;
    if (
      current.accountId !== context.accountId ||
      current.deviceId !== context.deviceId ||
      current.workspaceId !== context.workspaceId ||
      current.principal !== context.principal
    ) {
      return false;
    }

    try {
      this.devices.authorizeLocalAgent(current.accountId, current.deviceId, current.workspaceId);

      return true;
    } catch {
      return false;
    }
  }
}
