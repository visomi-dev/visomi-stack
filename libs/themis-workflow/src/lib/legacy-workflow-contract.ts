export type WorkItemStatus =
  | 'draft'
  | 'ready'
  | 'planned'
  | 'claimed'
  | 'in_progress'
  | 'review'
  | 'rework'
  | 'done'
  | 'blocked'
  | 'rejected'
  | 'cancelled';

export type WorkItemUpdate = Partial<
  Pick<WorkItem, 'title' | 'summary' | 'acceptanceCriteria' | 'scopeIn' | 'scopeOut' | 'verificationStrategy'>
>;

export type SprintStatus = 'draft' | 'proposed' | 'approved' | 'active' | 'closed';

export type ProjectStatus = 'active' | 'archived';

export type EpicStatus = 'draft' | 'active' | 'done' | 'cancelled';

export type ReviewVerdict = 'accepted' | 'rejected';

export type RunStatus = 'running' | 'completed' | 'failed';

export type EvidenceKind = 'verification' | 'implementation-diff' | 'command' | 'observation';

export type SprintEvidenceKind = 'verification' | 'command' | 'observation';

export type WorkItem = {
  id: string;
  title: string;
  summary: string;
  status: WorkItemStatus;
  projectId: string;
  epicId?: string;
  acceptanceCriteria: string[];
  scopeIn: string[];
  scopeOut: string[];
  verificationStrategy: string[];
  sprintId?: string;
  claimedBy?: string;
  claimedAt?: string;
};

export type Dependency = {
  from: string;
  to: string;
  relation: 'blocks';
};

export type SprintRevision = {
  id: string;
  sprintId: string;
  projectId: string;
  version: number;
  status: 'proposed' | 'approved';
  workItemIds: string[];
  epicIds: string[];
  why: string;
  what: string;
  how: string;
  nonGoals: string[];
  definitionOfDone: string[];
  verificationStrategy: string[];
  createdAt: string;
  approvedAt?: string;
};

export type Sprint = {
  id: string;
  projectId: string;
  goal: string;
  status: SprintStatus;
  activeRevisionId?: string;
  createdAt: string;
  closedAt?: string;
  closedBy?: string;
};

export type Project = {
  id: string;
  name: string;
  summary: string;
  status: ProjectStatus;
  createdAt: string;
};

export type Epic = {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  goal: string;
  status: EpicStatus;
  createdAt: string;
};

export type SprintMembership = {
  sprintId: string;
  workItemId: string;
  addedAt: string;
};

export type AgentRun = {
  id: string;
  workItemId: string;
  agent: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  terminationReason?: string;
};

export type Evidence = {
  id: string;
  runId: string;
  kind: EvidenceKind;
  summary: string;
  value: string;
  createdAt: string;
};

export type SprintEvidence = {
  id: string;
  sprintId: string;
  kind: SprintEvidenceKind;
  summary: string;
  value: string;
  createdAt: string;
};

export type SprintRemovalSummary = {
  removedSprintIds: string[];
  removedRevisionIds: string[];
  removedMemberships: number;
  removedSprintEvidence: number;
  resetPlannedWorkItems: string[];
};

export type Review = {
  id: string;
  workItemId: string;
  runId: string;
  reviewer: string;
  verdict?: ReviewVerdict;
  feedback?: string;
  createdAt: string;
  decidedAt?: string;
};

export type ThemisState = {
  schemaVersion: 2;
  projects: Project[];
  epics: Epic[];
  workItems: WorkItem[];
  dependencies: Dependency[];
  sprints: Sprint[];
  sprintItems: SprintMembership[];
  revisions: SprintRevision[];
  runs: AgentRun[];
  evidence: Evidence[];
  sprintEvidence: SprintEvidence[];
  reviews: Review[];
};

export type ThemisEvent = {
  schemaVersion: 1;
  sequence: number;
  timestamp: string;
  actor: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
};

export type WorkspaceStatus = {
  initialized: boolean;
  stateFileExists: boolean;
  eventsFileExists: boolean;
  counts: {
    projects: number;
    epics: number;
    workItems: number;
    sprints: number;
  };
};

export type TimelineEntry = ThemisEvent;

export type Clock = () => string;

export type SprintProposalInput = Omit<
  SprintRevision,
  'id' | 'sprintId' | 'projectId' | 'version' | 'status' | 'createdAt' | 'approvedAt' | 'epicIds'
> & {
  goal: string;
  projectId?: string;
  epicIds?: string[];
  sprintId?: string;
};

export type ProjectInput = Omit<Project, 'createdAt' | 'status'> & { status?: ProjectStatus };

export type EpicInput = Omit<Epic, 'createdAt' | 'status'> & { status?: EpicStatus };

export class ThemisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThemisError';
  }
}
