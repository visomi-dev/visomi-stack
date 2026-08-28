export type ResponseEnvelope<T> = {
  status?: number;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
};

export type ActivationMilestone =
  | 'activation_completed'
  | 'activation_skipped'
  | 'api_key_created'
  | 'config_copied'
  | 'seed_prompt_copied';

export type ActivationApiKey = {
  createdAt: string;
  id: string;
  label: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  tokenPrefix: string;
};

export type ActivationState = {
  apiKeys: ActivationApiKey[];
  milestones: ActivationMilestone[];
  seedPrompt: string;
};

export type CreateApiKeyPayload = {
  label: string;
};

export type CreatedApiKey = ActivationApiKey & {
  plaintextToken: string;
};
