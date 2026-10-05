export type ProjectRegistrationStatus = 'active' | 'disabled';
export type ProjectRegistration = {
  projectId: string;
  name: string;
  status: ProjectRegistrationStatus;
  locatorHash: string;
  rootPath: string;
  registeredAt: string;
  updatedAt: string;
};
export type PortableProjectIdentity = { projectId: string; name: string; status: ProjectRegistrationStatus };
export type WorkflowCursor = { projectId: string; sequence: number; eventId?: string };
export type WorkflowEvent = {
  eventId: string;
  projectId: string;
  sequence: number;
  type: string;
  timestamp: string;
  actor: string;
  payload: Record<string, unknown>;
};
export type WorkflowSnapshot = { projectId: string; sequence: number; state: unknown; createdAt: string };

export class WorkflowError extends Error {
  readonly code:
    | 'UNKNOWN_PROJECT'
    | 'PROJECT_DISABLED'
    | 'MOVED_ROOT'
    | 'LOCKED'
    | 'CORRUPT_STORE'
    | 'MIGRATION_REQUIRED'
    | 'CONFLICT'
    | 'INVALID_PROJECT_ID';

  constructor(message: string, code: WorkflowError['code']) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
  }
}
