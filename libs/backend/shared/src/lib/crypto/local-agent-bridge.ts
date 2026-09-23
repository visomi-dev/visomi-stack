export const LOCAL_AGENT_BRIDGE_FORMAT = 'themis.local-agent-bridge' as const;
export const LOCAL_AGENT_BRIDGE_VERSION = 1 as const;

export type LocalAgentBridgeCapability = 'projection';
export type LocalAgentBridgeState = 'ready' | 'locked' | 'revoked' | 'stale' | 'unsafe' | 'incompatible';

export type LocalAgentBridgeHello = Readonly<{
  format: typeof LOCAL_AGENT_BRIDGE_FORMAT;
  version: typeof LOCAL_AGENT_BRIDGE_VERSION;
  requestId: string;
  origin: string;
  capabilities: readonly LocalAgentBridgeCapability[];
}>;

export type LocalAgentBridgeWelcome = Readonly<{
  format: typeof LOCAL_AGENT_BRIDGE_FORMAT;
  version: typeof LOCAL_AGENT_BRIDGE_VERSION;
  requestId: string;
  origin: string;
  state: LocalAgentBridgeState;
  capabilities: readonly LocalAgentBridgeCapability[];
}>;

export type BridgeSelection =
  | { source: 'local-agent'; state: 'ready'; capabilities: readonly LocalAgentBridgeCapability[] }
  | {
      source: 'web-only';
      state: 'fallback';
      reason: 'unavailable' | 'timeout' | 'disconnected' | 'unsafe' | 'revoked';
    };

export function selectBridgeSource(
  welcome: LocalAgentBridgeWelcome | null,
  required: readonly LocalAgentBridgeCapability[] = ['projection'],
): BridgeSelection {
  if (!welcome) return { source: 'web-only', state: 'fallback', reason: 'unavailable' };
  if (welcome.state === 'revoked') return { source: 'web-only', state: 'fallback', reason: 'revoked' };
  if (welcome.state === 'unsafe' || welcome.state === 'incompatible') {
    return { source: 'web-only', state: 'fallback', reason: 'unsafe' };
  }
  if (welcome.state !== 'ready' || required.some((capability) => !welcome.capabilities.includes(capability))) {
    return { source: 'web-only', state: 'fallback', reason: 'unsafe' };
  }

  return { source: 'local-agent', state: 'ready', capabilities: welcome.capabilities };
}

export function redactBridgeDiagnostic(value: unknown): string {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : 'Bridge request failed.';

  return message
    .replace(/(authorization|cookie|token|secret|key|signature)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .slice(0, 180);
}

export function validateBridgeWelcome(
  value: unknown,
  expectedOrigin: string,
  requestId: string,
): LocalAgentBridgeWelcome {
  if (!value || typeof value !== 'object') throw new Error('Malformed bridge response.');
  const welcome = value as Partial<LocalAgentBridgeWelcome>;
  const states: LocalAgentBridgeState[] = ['ready', 'locked', 'revoked', 'stale', 'unsafe', 'incompatible'];

  if (
    welcome.format !== LOCAL_AGENT_BRIDGE_FORMAT ||
    welcome.version !== LOCAL_AGENT_BRIDGE_VERSION ||
    welcome.requestId !== requestId ||
    welcome.origin !== expectedOrigin ||
    !states.includes(welcome.state as LocalAgentBridgeState) ||
    !Array.isArray(welcome.capabilities)
  ) {
    throw new Error('Malformed or origin-mismatched bridge response.');
  }

  return welcome as LocalAgentBridgeWelcome;
}
