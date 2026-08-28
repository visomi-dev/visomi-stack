export const CLIENT_CAPABILITY_FORMAT = 'themis.client-capability' as const;
export const CLIENT_CAPABILITY_VERSION = 1 as const;

export type ClientProfile = 'web-local-agent' | 'web-webcrypto';
export type ClientMode = 'local-agent' | 'webcrypto';
export type ClientCapability = 'vault-access' | 'unlock' | 'projection' | 'bridge' | 'sync' | 'recovery' | 'offline';

export type ClientState =
  | 'locked'
  | 'unavailable'
  | 'revoked'
  | 'offline'
  | 'incompatible-version'
  | 'recovery-required';

export type CapabilityAuthenticator = Readonly<{
  scheme: 'web-session' | 'local-agent-signature';
  keyId: string;
  proof: string;
}>;

export type ClientCapabilityClaim = Readonly<{
  format: typeof CLIENT_CAPABILITY_FORMAT;
  version: typeof CLIENT_CAPABILITY_VERSION;
  claimId: string;
  clientId: string;
  clientProfile: ClientProfile;
  accountId: string;
  workspaceId: string;
  capabilities: readonly ClientCapability[];
  issuedAt: string;
  expiresAt: string;
  authenticator: CapabilityAuthenticator;
}>;

export type ModeNegotiationRequest = Readonly<{
  format: 'themis.mode-negotiation-request';
  requestId: string;
  clientId: string;
  clientProfile: ClientProfile;
  supportedModes: readonly ClientMode[];
  supportedVersions: readonly number[];
  requestedCapabilities: readonly ClientCapability[];
  preferredMode: ClientMode;
  allowDowngrade: boolean;
  claim: ClientCapabilityClaim;
}>;

export type ModeNegotiationResponse = Readonly<{
  format: 'themis.mode-negotiation-response';
  requestId: string;
  version: typeof CLIENT_CAPABILITY_VERSION;
  clientProfile: ClientProfile;
  selectedMode: ClientMode;
  grantedCapabilities: readonly ClientCapability[];
  state: 'ready';
}>;

export type ClientCapabilityErrorCode =
  | 'malformed'
  | 'unsupported-version'
  | 'unsupported-version'
  | 'unauthenticated'
  | 'ambiguous-identity'
  | 'unsupported-capability'
  | 'unsafe-downgrade'
  | ClientState;

export class ClientCapabilityContractError extends Error {
  public constructor(
    readonly code: ClientCapabilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClientCapabilityContractError';
  }
}

const profileModes: Record<ClientProfile, readonly ClientMode[]> = {
  'web-local-agent': ['local-agent', 'webcrypto'],
  'web-webcrypto': ['webcrypto'],
};

const modeCapabilities: Record<ClientMode, readonly ClientCapability[]> = {
  'local-agent': ['vault-access', 'unlock', 'projection', 'bridge', 'sync', 'recovery', 'offline'],
  webcrypto: ['vault-access', 'unlock', 'projection', 'sync', 'offline'],
};

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function capabilitiesForMode(mode: ClientMode): readonly ClientCapability[] {
  return modeCapabilities[mode];
}

export function intersectClientCapabilities(
  requested: readonly ClientCapability[],
  available: readonly ClientCapability[],
): ClientCapability[] {
  const availableSet = new Set(available);

  return unique(requested).filter((capability) => availableSet.has(capability));
}

export function stateError(state: ClientState): ClientCapabilityContractError {
  return new ClientCapabilityContractError(state, `Client capability state is ${state}.`);
}

function malformed(message: string): never {
  throw new ClientCapabilityContractError('malformed', message);
}

function validateClaim(request: ModeNegotiationRequest, now: number): void {
  const { claim } = request;

  if (
    claim.format !== CLIENT_CAPABILITY_FORMAT ||
    claim.version !== CLIENT_CAPABILITY_VERSION ||
    !claim.claimId ||
    !claim.clientId ||
    !claim.accountId ||
    !claim.workspaceId ||
    !claim.authenticator.keyId ||
    !claim.authenticator.proof
  ) {
    malformed('Capability claim is malformed.');
  }

  if (claim.clientId !== request.clientId || claim.clientProfile !== request.clientProfile) {
    throw new ClientCapabilityContractError('ambiguous-identity', 'Client identity does not match its claim.');
  }

  const issuedAt = Date.parse(claim.issuedAt);
  const expiresAt = Date.parse(claim.expiresAt);

  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt) || expiresAt <= issuedAt) {
    malformed('Capability claim timestamps are invalid.');
  }
  if (now < issuedAt || now >= expiresAt) {
    throw stateError('unavailable');
  }
}

export function negotiateClientMode(
  request: ModeNegotiationRequest,
  verifyClaim: (claim: ClientCapabilityClaim) => boolean,
  now = Date.now(),
): ModeNegotiationResponse {
  if (request.format !== 'themis.mode-negotiation-request' || !request.requestId) {
    malformed('Mode negotiation request is malformed.');
  }
  if (!request.supportedVersions.includes(CLIENT_CAPABILITY_VERSION)) {
    throw new ClientCapabilityContractError('unsupported-version', 'No compatible capability contract version exists.');
  }
  validateClaim(request, now);
  if (!verifyClaim(request.claim)) {
    throw new ClientCapabilityContractError('unauthenticated', 'Capability claim authentication failed.');
  }

  const profileModesSupported = profileModes[request.clientProfile];
  const modes = unique(request.supportedModes).filter((mode) => profileModesSupported.includes(mode));
  const selectedMode = modes.includes(request.preferredMode)
    ? request.preferredMode
    : modes.includes('webcrypto')
      ? 'webcrypto'
      : undefined;

  if (!selectedMode) {
    throw new ClientCapabilityContractError('unsupported-capability', 'No supported client mode is available.');
  }
  if (selectedMode !== request.preferredMode && !request.allowDowngrade) {
    throw new ClientCapabilityContractError('unsafe-downgrade', 'The requested client mode cannot be downgraded.');
  }

  const requested = unique(request.requestedCapabilities);
  const available = new Set(intersectClientCapabilities(requested, modeCapabilities[selectedMode]));

  const unsupported = requested.filter((capability) => !available.has(capability));

  if (unsupported.length > 0) {
    throw new ClientCapabilityContractError(
      selectedMode === 'webcrypto' && unsupported.includes('bridge') ? 'unsafe-downgrade' : 'unsupported-capability',
      `Requested capabilities are unavailable in ${selectedMode} mode.`,
    );
  }

  return {
    format: 'themis.mode-negotiation-response',
    requestId: request.requestId,
    version: CLIENT_CAPABILITY_VERSION,
    clientProfile: request.clientProfile,
    selectedMode,
    grantedCapabilities: requested,
    state: 'ready',
  };
}
