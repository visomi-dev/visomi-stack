type OperationalVisibility =
  | 'visible'
  | 'empty'
  | 'locked'
  | 'unavailable'
  | 'stale'
  | 'error'
  | 'unauthorized'
  | 'malformed';

type OperationalAuthority = 'control-plane' | 'local-agent' | 'opaque-encrypted-source';

type OperationalCollection<T> = {
  authority: OperationalAuthority;
  items: T[];
  state: OperationalVisibility;
  source: string;
  observedAt: string;
  reason?: string;
};

type OperationalEpic = {
  id: string;
  projectId: string;
  title: string;
  summary: string | null;
  status: 'active' | 'closed';
};
type OperationalWorkItem = {
  id: string;
  epicId: string | null;
  title: string;
  status: 'draft' | 'ready' | 'in_progress' | 'review' | 'blocked' | 'done';
  updatedAt: string;
  intent?: string;
  scope?: string;
  dependencies?: string[];
  nextAction?: string;
};
type OperationalRun = {
  id: string;
  workItemId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
};
type OperationalEvidence = {
  id: string;
  runId: string;
  kind: 'verification' | 'implementation-diff' | 'observation' | 'command';
  createdAt: string;
  summary?: string;
  result?: 'passed' | 'failed' | 'blocked';
};
type OperationalReview = {
  id: string;
  workItemId: string;
  verdict: 'accepted' | 'rejected' | 'pending' | 'rework';
  createdAt: string;
  reviewer?: string;
  feedback?: string;
};
type OperationalActivity = {
  id: string;
  projectId: string;
  kind: 'status' | 'progress' | 'run' | 'review';
  occurredAt: string;
  summary: string;
};
type OperationalProtectedContext = {
  id: string;
  projectId: string;
  kind: 'description' | 'decision' | 'note';
  value: string;
};

type OperationalProject = {
  id: string;
  name: string;
  status: 'active' | 'archived' | 'draft';
  visibility: 'operational';
  updatedAt: string;
};

type OperationalWorkspaceReadModel = {
  schemaVersion: '1';
  readOnly: true;
  project: OperationalCollection<OperationalProject>;
  protectedContext: OperationalCollection<OperationalProtectedContext>;
  epics: OperationalCollection<OperationalEpic>;
  workItems: OperationalCollection<OperationalWorkItem>;
  runs: OperationalCollection<OperationalRun>;
  evidence: OperationalCollection<OperationalEvidence>;
  reviews: OperationalCollection<OperationalReview>;
  activity: OperationalCollection<OperationalActivity>;
  iteration?: OperationalCollection<{ id: string; name: string; status: 'active' | 'closed'; goal: string }>;
};

export type {
  OperationalAuthority,
  OperationalCollection,
  OperationalProject,
  OperationalEpic,
  OperationalWorkItem,
  OperationalRun,
  OperationalEvidence,
  OperationalReview,
  OperationalActivity,
  OperationalProtectedContext,
  OperationalVisibility,
  OperationalWorkspaceReadModel,
};
