import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type WorkItemStatus =
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

type WorkItemUpdate = Partial<
  Pick<WorkItem, 'title' | 'summary' | 'acceptanceCriteria' | 'scopeIn' | 'scopeOut' | 'verificationStrategy'>
>;

type SprintStatus = 'draft' | 'proposed' | 'approved' | 'active' | 'closed';
type ProjectStatus = 'active' | 'archived';
type EpicStatus = 'draft' | 'active' | 'done' | 'cancelled';
type ReviewVerdict = 'accepted' | 'rejected';
type RunStatus = 'running' | 'completed' | 'failed';
type EvidenceKind = 'verification' | 'implementation-diff' | 'command' | 'observation';
type SprintEvidenceKind = 'verification' | 'command' | 'observation';

type WorkItem = {
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

type Dependency = {
  from: string;
  to: string;
  relation: 'blocks';
};

type SprintRevision = {
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

type Sprint = {
  id: string;
  projectId: string;
  goal: string;
  status: SprintStatus;
  activeRevisionId?: string;
  createdAt: string;
  closedAt?: string;
  closedBy?: string;
};

type Project = {
  id: string;
  name: string;
  summary: string;
  status: ProjectStatus;
  createdAt: string;
};

type Epic = {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  goal: string;
  status: EpicStatus;
  createdAt: string;
};

type SprintMembership = {
  sprintId: string;
  workItemId: string;
  addedAt: string;
};

type AgentRun = {
  id: string;
  workItemId: string;
  agent: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  terminationReason?: string;
};

type Evidence = {
  id: string;
  runId: string;
  kind: EvidenceKind;
  summary: string;
  value: string;
  createdAt: string;
};

type SprintEvidence = {
  id: string;
  sprintId: string;
  kind: SprintEvidenceKind;
  summary: string;
  value: string;
  createdAt: string;
};

type SprintRemovalSummary = {
  removedSprintIds: string[];
  removedRevisionIds: string[];
  removedMemberships: number;
  removedSprintEvidence: number;
  resetPlannedWorkItems: string[];
};

type Review = {
  id: string;
  workItemId: string;
  runId: string;
  reviewer: string;
  verdict?: ReviewVerdict;
  feedback?: string;
  createdAt: string;
  decidedAt?: string;
};

type ThemisState = {
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

type ThemisEvent = {
  schemaVersion: 1;
  sequence: number;
  timestamp: string;
  actor: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
};

type WorkspaceStatus = {
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

type TimelineEntry = ThemisEvent;

type Clock = () => string;

type SprintProposalInput = Omit<
  SprintRevision,
  'id' | 'sprintId' | 'projectId' | 'version' | 'status' | 'createdAt' | 'approvedAt' | 'epicIds'
> & {
  goal: string;
  projectId?: string;
  epicIds?: string[];
  sprintId?: string;
};

type ProjectInput = Omit<Project, 'createdAt' | 'status'> & { status?: ProjectStatus };
type EpicInput = Omit<Epic, 'createdAt' | 'status'> & { status?: EpicStatus };

const defaultClock: Clock = () => new Date().toISOString();

const emptyState = (): ThemisState => ({
  schemaVersion: 2,
  projects: [],
  epics: [],
  workItems: [],
  dependencies: [],
  sprints: [],
  sprintItems: [],
  revisions: [],
  runs: [],
  evidence: [],
  sprintEvidence: [],
  reviews: [],
});

const paths = (root: string) => {
  // Project migration stores are rooted directly at the registered project
  // directory; legacy/workspace stores retain the .themis container.
  const directory =
    existsSync(join(root, 'state.json')) || existsSync(join(root, 'events.ndjson')) ? root : join(root, '.themis');
  return {
    directory,
    state: join(directory, 'state.json'),
    events: join(directory, 'events.ndjson'),
  };
};

const readEvents = (root: string): ThemisEvent[] => {
  const location = paths(root).events;
  if (!existsSync(location)) return [];
  return readFileSync(location, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ThemisEvent);
};

const workspaceStatus = (root: string): WorkspaceStatus => {
  const location = paths(root);
  const stateFileExists = existsSync(location.state);
  const eventsFileExists = existsSync(location.events);
  if (!stateFileExists && !eventsFileExists) {
    return {
      initialized: false,
      stateFileExists,
      eventsFileExists,
      counts: { projects: 0, epics: 0, workItems: 0, sprints: 0 },
    };
  }
  const state = readState(root);
  return {
    initialized: true,
    stateFileExists,
    eventsFileExists,
    counts: {
      projects: state.projects.length,
      epics: state.epics.length,
      workItems: state.workItems.length,
      sprints: state.sprints.length,
    },
  };
};

const migrateState = (raw: Partial<ThemisState>): ThemisState => {
  const state = {
    ...emptyState(),
    ...raw,
    projects: raw.projects ?? [],
    epics: raw.epics ?? [],
    workItems: raw.workItems ?? [],
    dependencies: raw.dependencies ?? [],
    sprints: raw.sprints ?? [],
    sprintItems: raw.sprintItems ?? [],
    revisions: raw.revisions ?? [],
    runs: raw.runs ?? [],
    evidence: raw.evidence ?? [],
    sprintEvidence: raw.sprintEvidence ?? [],
    reviews: raw.reviews ?? [],
  } as ThemisState;
  const defaultProjectId = 'PRJ-LOCAL';
  if (
    (state.workItems.some((item) => !item.projectId) || state.sprints.some((sprint) => !sprint.projectId)) &&
    !state.projects.some((project) => project.id === defaultProjectId)
  ) {
    state.projects.push({
      id: defaultProjectId,
      name: 'Local workspace',
      summary: 'Default project for local workflow items',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
  }
  for (const item of state.workItems) {
    item.projectId ||= defaultProjectId;
    if (
      item.sprintId &&
      !state.sprintItems.some(
        (membership) => membership.workItemId === item.id && membership.sprintId === item.sprintId,
      )
    ) {
      state.sprintItems.push({ sprintId: item.sprintId, workItemId: item.id, addedAt: new Date().toISOString() });
    }
  }
  for (const sprint of state.sprints) {
    sprint.projectId ||=
      state.sprintItems
        .filter((membership) => membership.sprintId === sprint.id)
        .map((membership) => state.workItems.find((item) => item.id === membership.workItemId)?.projectId)
        .find((projectId): projectId is string => projectId !== undefined) ?? defaultProjectId;
  }
  for (const revision of state.revisions) {
    revision.projectId ||=
      state.sprints.find((sprint) => sprint.id === revision.sprintId)?.projectId ?? defaultProjectId;
    revision.epicIds ||= [
      ...new Set(
        revision.workItemIds
          .map((id) => state.workItems.find((item) => item.id === id)?.epicId)
          .filter((id): id is string => id !== undefined),
      ),
    ];
  }
  state.schemaVersion = 2;
  return state;
};

const readState = (root: string): ThemisState => {
  const location = paths(root);
  mkdirSync(location.directory, { recursive: true });
  if (!existsSync(location.state)) {
    const state = emptyState();
    writeFileSync(location.state, JSON.stringify(state, null, 2) + '\n', 'utf8');
    return state;
  }

  const raw = JSON.parse(readFileSync(location.state, 'utf8')) as Partial<ThemisState>;
  const state = migrateState(raw);
  if (raw.schemaVersion !== state.schemaVersion)
    writeFileSync(location.state, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return state;
};

const writeState = (root: string, state: ThemisState): void => {
  const location = paths(root);
  const temporary = `${location.state}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', 'utf8');
  renameSync(temporary, location.state);
};

const nextId = (prefix: string, values: string[]): string => {
  const numbers = values
    .filter((value) => value.startsWith(`${prefix}-`))
    .map((value) => Number(value.slice(prefix.length + 1)))
    .filter((value) => Number.isInteger(value));
  const next = Math.max(0, ...numbers) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
};

const appendEvent = (
  root: string,
  actor: string,
  type: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  clock: Clock,
): ThemisEvent => {
  const location = paths(root);
  mkdirSync(dirname(location.events), { recursive: true });
  const existing = existsSync(location.events)
    ? readFileSync(location.events, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ThemisEvent)
    : [];
  const event: ThemisEvent = {
    schemaVersion: 1,
    sequence: existing.length + 1,
    timestamp: clock(),
    actor,
    type,
    aggregateType,
    aggregateId,
    payload,
  };
  appendFileSync(location.events, JSON.stringify(event) + '\n', 'utf8');
  return event;
};

class ThemisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThemisError';
  }
}

const requireWorkItem = (state: ThemisState, id: string): WorkItem => {
  const item = state.workItems.find((candidate) => candidate.id === id);
  if (!item) throw new ThemisError(`Work item not found: ${id}`);
  return item;
};

const requireSprint = (state: ThemisState, id: string): Sprint => {
  const sprint = state.sprints.find((candidate) => candidate.id === id);
  if (!sprint) throw new ThemisError(`Sprint not found: ${id}`);
  return sprint;
};

const requireProject = (state: ThemisState, id: string): Project => {
  const project = state.projects.find((candidate) => candidate.id === id);
  if (!project) throw new ThemisError(`Project not found: ${id}`);
  return project;
};

const requireEpic = (state: ThemisState, id: string): Epic => {
  const epic = state.epics.find((candidate) => candidate.id === id);
  if (!epic) throw new ThemisError(`Epic not found: ${id}`);
  return epic;
};

const ensureDefaultProject = (state: ThemisState, clock: Clock): Project => {
  const existing = state.projects.find((project) => project.id === 'PRJ-LOCAL');
  if (existing) return existing;
  const project: Project = {
    id: 'PRJ-LOCAL',
    name: 'Local workspace',
    summary: 'Default project for local workflow validation',
    status: 'active',
    createdAt: clock(),
  };
  state.projects.push(project);
  return project;
};

const sprintMemberships = (state: ThemisState, sprintId: string): SprintMembership[] =>
  state.sprintItems.filter((membership) => membership.sprintId === sprintId);

const itemSprintIds = (state: ThemisState, workItemId: string): string[] =>
  state.sprintItems
    .filter((membership) => membership.workItemId === workItemId)
    .map((membership) => membership.sprintId);

const createProject = (
  root: string,
  input: ProjectInput,
  actor = 'human:planner',
  clock: Clock = defaultClock,
): Project =>
  mutate(
    root,
    actor,
    'project.created',
    'project',
    input.id,
    (state) => {
      if (state.projects.some((project) => project.id === input.id))
        throw new ThemisError(`Project already exists: ${input.id}`);
      const project: Project = {
        ...input,
        summary: input.summary ?? '',
        status: input.status ?? 'active',
        createdAt: clock(),
      };
      state.projects.push(project);
      return project;
    },
    (project) => ({ projectId: project.id, status: project.status }),
    clock,
  );

const createEpic = (root: string, input: EpicInput, actor = 'agent:planner', clock: Clock = defaultClock): Epic =>
  mutate(
    root,
    actor,
    'epic.created',
    'epic',
    input.id,
    (state) => {
      requireProject(state, input.projectId);
      if (state.epics.some((epic) => epic.id === input.id)) throw new ThemisError(`Epic already exists: ${input.id}`);
      const epic: Epic = {
        ...input,
        summary: input.summary ?? '',
        goal: input.goal ?? '',
        status: input.status ?? 'active',
        createdAt: clock(),
      };
      state.epics.push(epic);
      return epic;
    },
    (epic) => ({ epicId: epic.id, projectId: epic.projectId, status: epic.status }),
    clock,
  );

const requireRun = (state: ThemisState, id: string): AgentRun => {
  const run = state.runs.find((candidate) => candidate.id === id);
  if (!run) throw new ThemisError(`Run not found: ${id}`);
  return run;
};

const blockingDependencies = (state: ThemisState, itemId: string): WorkItem[] =>
  state.dependencies
    .filter((dependency) => dependency.to === itemId && dependency.relation === 'blocks')
    .map((dependency) => requireWorkItem(state, dependency.from))
    .filter((dependency) => dependency.status !== 'done');

const requireFieldsForReady = (item: WorkItem): void => {
  const missing: string[] = [];
  if (item.acceptanceCriteria.length === 0) missing.push('acceptance criteria');
  if (item.scopeIn.length === 0) missing.push('scope in');
  if (item.verificationStrategy.length === 0) missing.push('verification strategy');
  if (missing.length > 0) {
    throw new ThemisError(`${item.id} cannot move to ready. Missing: ${missing.join(', ')}`);
  }
};

const allowedTransitions: Record<WorkItemStatus, WorkItemStatus[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['planned', 'blocked', 'cancelled'],
  planned: ['claimed', 'blocked', 'cancelled'],
  claimed: ['in_progress', 'blocked'],
  in_progress: ['review', 'blocked'],
  review: ['done', 'rework', 'rejected'],
  rework: ['claimed', 'cancelled'],
  done: ['rework'],
  blocked: ['ready', 'cancelled'],
  rejected: ['draft', 'cancelled'],
  cancelled: [],
};

const mutate = <T>(
  root: string,
  actor: string,
  type: string,
  aggregateType: string,
  aggregateId: string,
  operation: (state: ThemisState) => T,
  payload: (result: T) => Record<string, unknown>,
  clock: Clock = defaultClock,
): T => {
  const state = readState(root);
  const result = operation(state);
  writeState(root, state);
  appendEvent(root, actor, type, aggregateType, aggregateId, payload(result), clock);
  return result;
};

const createWorkItem = (
  root: string,
  input: Omit<WorkItem, 'id' | 'status' | 'projectId' | 'epicId'> & {
    id?: string;
    projectId?: string;
    epicId?: string;
  },
  actor = 'agent:planner',
  clock: Clock = defaultClock,
): WorkItem =>
  mutate(
    root,
    actor,
    'workitem.created',
    'work_item',
    input.id ?? 'pending',
    (state) => {
      const project = input.projectId ? requireProject(state, input.projectId) : ensureDefaultProject(state, clock);
      if (project.status !== 'active') throw new ThemisError(`Project is not active: ${project.id}`);
      if (input.epicId) {
        const epic = requireEpic(state, input.epicId);
        if (epic.projectId !== project.id)
          throw new ThemisError(`${input.epicId} does not belong to project ${project.id}`);
      }
      const id =
        input.id ??
        nextId(
          'THM',
          state.workItems.map((item) => item.id),
        );
      if (state.workItems.some((item) => item.id === id)) throw new ThemisError(`Work item already exists: ${id}`);
      const item: WorkItem = { ...input, id, projectId: project.id, status: 'draft' };
      state.workItems.push(item);
      return item;
    },
    (item) => ({ id: item.id, title: item.title, status: item.status }),
    clock,
  );

const updateWorkItem = (
  root: string,
  id: string,
  patch: WorkItemUpdate,
  actor = 'agent:planner',
  clock: Clock = defaultClock,
): WorkItem =>
  mutate(
    root,
    actor,
    'workitem.updated',
    'work_item',
    id,
    (state) => {
      const item = requireWorkItem(state, id);
      const changedFields = Object.keys(patch) as (keyof WorkItemUpdate)[];

      if (changedFields.length === 0) throw new ThemisError(`${id} update has no fields`);

      if (patch.title !== undefined) item.title = patch.title;
      if (patch.summary !== undefined) item.summary = patch.summary;
      if (patch.acceptanceCriteria !== undefined) item.acceptanceCriteria = patch.acceptanceCriteria;
      if (patch.scopeIn !== undefined) item.scopeIn = patch.scopeIn;
      if (patch.scopeOut !== undefined) item.scopeOut = patch.scopeOut;
      if (patch.verificationStrategy !== undefined) item.verificationStrategy = patch.verificationStrategy;

      const previousStatus = item.status;
      if (previousStatus === 'done' || previousStatus === 'review') item.status = 'rework';

      return { ...item, previousStatus, changedFields } as WorkItem & {
        previousStatus: WorkItemStatus;
        changedFields: (keyof WorkItemUpdate)[];
      };
    },
    (item) => ({
      previousStatus: item.previousStatus,
      status: item.status,
      changedFields: item.changedFields,
    }),
    clock,
  );

const transitionWorkItem = (
  root: string,
  id: string,
  to: WorkItemStatus,
  actor = 'agent:coordinator',
  clock: Clock = defaultClock,
): WorkItem =>
  mutate(
    root,
    actor,
    'workitem.transitioned',
    'work_item',
    id,
    (state) => {
      const item = requireWorkItem(state, id);
      const from = item.status;
      if (from === to) throw new ThemisError(`${id} is already ${to}`);
      if (!allowedTransitions[from].includes(to)) {
        throw new ThemisError(`${id} cannot move from ${from} to ${to}`);
      }
      if (to === 'ready') requireFieldsForReady(item);
      if (to === 'claimed' && blockingDependencies(state, id).length > 0) {
        throw new ThemisError(
          `${id} is blocked by: ${blockingDependencies(state, id)
            .map((dependency) => dependency.id)
            .join(', ')}`,
        );
      }
      if (to === 'review') {
        const run = state.runs.find((candidate) => candidate.workItemId === id && candidate.status === 'completed');
        if (!run) throw new ThemisError(`${id} cannot move to review without a completed run`);
        const evidence = state.evidence.filter((entry) => entry.runId === run.id);
        if (!evidence.some((entry) => entry.kind === 'verification'))
          throw new ThemisError(`${id} cannot move to review. Missing evidence: verification`);
        if (!evidence.some((entry) => entry.kind === 'implementation-diff'))
          throw new ThemisError(`${id} cannot move to review. Missing evidence: implementation-diff`);
      }
      if (to === 'done' && !state.reviews.some((review) => review.workItemId === id && review.verdict === 'accepted')) {
        throw new ThemisError(`${id} cannot move to done without an accepted review`);
      }
      item.status = to;
      return { ...item, previousStatus: from } as WorkItem & { previousStatus: WorkItemStatus };
    },
    (item) => ({ previousStatus: item.previousStatus, status: item.status }),
    clock,
  );

const addDependency = (
  root: string,
  from: string,
  to: string,
  actor = 'agent:planner',
  clock: Clock = defaultClock,
): Dependency =>
  mutate(
    root,
    actor,
    'dependency.added',
    'work_item',
    to,
    (state) => {
      requireWorkItem(state, from);
      requireWorkItem(state, to);
      if (from === to) throw new ThemisError('A work item cannot block itself');
      if (state.dependencies.some((dependency) => dependency.from === from && dependency.to === to))
        throw new ThemisError('Dependency already exists');
      const dependency: Dependency = { from, to, relation: 'blocks' };
      state.dependencies.push(dependency);
      return dependency;
    },
    (dependency) => dependency,
    clock,
  );

const proposeSprint = (
  root: string,
  input: SprintProposalInput,
  actor = 'agent:planner',
  clock: Clock = defaultClock,
): SprintRevision =>
  mutate(
    root,
    actor,
    'sprint.proposed',
    'sprint',
    input.sprintId ?? 'pending',
    (state) => {
      const firstItem = requireWorkItem(state, input.workItemIds[0] ?? '');
      const projectId = input.projectId ?? firstItem.projectId;
      const project = requireProject(state, projectId);
      if (project.status !== 'active') throw new ThemisError(`Project is not active: ${projectId}`);
      for (const id of input.workItemIds) {
        const item = requireWorkItem(state, id);
        if (item.status !== 'ready') throw new ThemisError(`${id} must be ready before sprint planning`);
        if (item.projectId !== projectId) throw new ThemisError(`${id} does not belong to project ${projectId}`);
      }
      const epicIds = input.epicIds ?? [
        ...new Set(
          input.workItemIds
            .map((id) => requireWorkItem(state, id).epicId)
            .filter((id): id is string => id !== undefined),
        ),
      ];
      for (const epicId of epicIds) {
        const epic = requireEpic(state, epicId);
        if (epic.projectId !== projectId) throw new ThemisError(`${epicId} does not belong to project ${projectId}`);
      }
      const sprintId =
        input.sprintId ??
        nextId(
          'SPR',
          state.sprints.map((sprint) => sprint.id),
        );
      const sprint = state.sprints.find((candidate) => candidate.id === sprintId);
      if (sprint && sprint.status === 'active') throw new ThemisError(`${sprintId} is already active`);
      if (sprint && sprint.projectId !== projectId)
        throw new ThemisError(`${sprintId} does not belong to project ${projectId}`);
      if (!sprint)
        state.sprints.push({ id: sprintId, projectId, goal: input.goal, status: 'proposed', createdAt: clock() });
      const version = state.revisions.filter((revision) => revision.sprintId === sprintId).length + 1;
      const revision: SprintRevision = {
        ...input,
        id: nextId(
          'REV',
          state.revisions.map((candidate) => candidate.id),
        ),
        sprintId,
        projectId,
        version,
        epicIds,
        status: 'proposed',
        createdAt: clock(),
      };
      state.revisions.push(revision);
      return revision;
    },
    (revision) => ({ sprintId: revision.sprintId, revisionId: revision.id, version: revision.version }),
    clock,
  );

const approveSprint = (
  root: string,
  sprintId: string,
  revisionId: string,
  actor = 'human:owner',
  clock: Clock = defaultClock,
): SprintRevision =>
  mutate(
    root,
    actor,
    'sprint.approved',
    'sprint',
    sprintId,
    (state) => {
      const sprint = requireSprint(state, sprintId);
      const project = requireProject(state, sprint.projectId);
      if (project.status !== 'active') throw new ThemisError(`Project is not active: ${project.id}`);
      if (sprint.status !== 'proposed' && sprint.status !== 'draft')
        throw new ThemisError(`${sprintId} cannot be approved from ${sprint.status}`);
      const revision = state.revisions.find(
        (candidate) => candidate.id === revisionId && candidate.sprintId === sprintId,
      );
      if (!revision) throw new ThemisError(`Revision not found: ${revisionId}`);
      revision.status = 'approved';
      revision.approvedAt = clock();
      sprint.status = 'approved';
      return revision;
    },
    (revision) => ({ revisionId: revision.id, status: revision.status }),
    clock,
  );

const activateSprint = (
  root: string,
  sprintId: string,
  revisionId: string,
  actor = 'human:owner',
  clock: Clock = defaultClock,
): Sprint =>
  mutate(
    root,
    actor,
    'sprint.activated',
    'sprint',
    sprintId,
    (state) => {
      const sprint = requireSprint(state, sprintId);
      const project = requireProject(state, sprint.projectId);
      if (project.status !== 'active') throw new ThemisError(`Project is not active: ${project.id}`);
      const revision = state.revisions.find(
        (candidate) =>
          candidate.id === revisionId && candidate.sprintId === sprintId && candidate.status === 'approved',
      );
      if (!revision) throw new ThemisError(`${revisionId} must be approved before activation`);
      if (state.sprints.some((candidate) => candidate.projectId === sprint.projectId && candidate.status === 'active'))
        throw new ThemisError(`Project ${sprint.projectId} already has an active sprint`);
      sprint.status = 'active';
      sprint.activeRevisionId = revisionId;
      for (const id of revision.workItemIds) {
        const item = requireWorkItem(state, id);
        if (item.status !== 'ready') throw new ThemisError(`${id} must be ready before sprint activation`);
        requireFieldsForReady(item);
        const activeMembership = itemSprintIds(state, id).find((membershipSprintId) =>
          state.sprints.some((candidate) => candidate.id === membershipSprintId && candidate.status === 'active'),
        );
        if (activeMembership) throw new ThemisError(`${id} is already assigned to active sprint ${activeMembership}`);
        state.sprintItems.push({ sprintId, workItemId: id, addedAt: clock() });
        item.sprintId = sprintId;
        item.status = 'planned';
      }
      return sprint;
    },
    (sprint) => ({ sprintId: sprint.id, revisionId, status: sprint.status }),
    clock,
  );

const addSprintEvidence = (
  root: string,
  sprintId: string,
  kind: SprintEvidenceKind,
  summary: string,
  value: string,
  actor = 'agent:verifier',
  clock: Clock = defaultClock,
): SprintEvidence =>
  mutate(
    root,
    actor,
    'sprint.evidence.added',
    'sprint',
    sprintId,
    (state) => {
      const sprint = requireSprint(state, sprintId);
      if (sprint.status !== 'active') throw new ThemisError(`${sprintId} must be active before adding evidence`);
      const evidence: SprintEvidence = {
        id: nextId(
          'SEVD',
          state.sprintEvidence.map((entry) => entry.id),
        ),
        sprintId,
        kind,
        summary,
        value,
        createdAt: clock(),
      };
      state.sprintEvidence.push(evidence);
      return evidence;
    },
    (evidence) => ({ sprintId: evidence.sprintId, evidenceId: evidence.id, kind: evidence.kind }),
    clock,
  );

const closeSprint = (
  root: string,
  sprintId: string,
  projectId: string,
  actor = 'human:owner',
  clock: Clock = defaultClock,
): Sprint =>
  mutate(
    root,
    actor,
    'sprint.closed',
    'sprint',
    sprintId,
    (state) => {
      const sprint = requireSprint(state, sprintId);
      if (sprint.projectId !== projectId) throw new ThemisError(`${sprintId} does not belong to project ${projectId}`);
      if (sprint.status !== 'active') throw new ThemisError(`${sprintId} cannot be closed from ${sprint.status}`);
      const memberships = sprintMemberships(state, sprintId);
      const items = memberships.map(({ workItemId }) => requireWorkItem(state, workItemId));
      const unfinished = items.filter((item) => item.status !== 'done' && item.status !== 'cancelled');
      if (unfinished.length > 0)
        throw new ThemisError(`Sprint has unfinished work: ${unfinished.map((item) => item.id).join(', ')}`);
      const openRuns = state.runs.filter(
        (run) => memberships.some(({ workItemId }) => workItemId === run.workItemId) && run.status === 'running',
      );
      if (openRuns.length > 0)
        throw new ThemisError(`Sprint has open runs: ${openRuns.map((run) => run.id).join(', ')}`);
      const pendingReviews = state.reviews.filter(
        (review) => memberships.some(({ workItemId }) => workItemId === review.workItemId) && !review.verdict,
      );
      if (pendingReviews.length > 0)
        throw new ThemisError(`Sprint has pending reviews: ${pendingReviews.map((review) => review.id).join(', ')}`);
      const evidence = state.sprintEvidence.filter((entry) => entry.sprintId === sprintId);
      if (!evidence.some((entry) => entry.kind === 'verification'))
        throw new ThemisError(`${sprintId} is missing final verification evidence`);
      sprint.status = 'closed';
      sprint.closedAt = clock();
      sprint.closedBy = actor;
      return sprint;
    },
    (sprint) => ({
      projectId: sprint.projectId,
      sprintId: sprint.id,
      revisionId: sprint.activeRevisionId,
      status: sprint.status,
    }),
    clock,
  );

const removeSprints = (
  root: string,
  projectId?: string,
  actor = 'human:owner',
  clock: Clock = defaultClock,
): SprintRemovalSummary =>
  mutate(
    root,
    actor,
    'sprints.removed',
    'project',
    projectId ?? 'workspace',
    (state) => {
      const sprintIds = new Set(
        state.sprints.filter((sprint) => !projectId || sprint.projectId === projectId).map((sprint) => sprint.id),
      );
      const removedSprintIds = [...sprintIds];
      const removedRevisionIds = state.revisions
        .filter((revision) => sprintIds.has(revision.sprintId))
        .map((revision) => revision.id);
      const removedMemberships = state.sprintItems.filter((membership) => sprintIds.has(membership.sprintId)).length;
      const removedSprintEvidence = state.sprintEvidence.filter((evidence) => sprintIds.has(evidence.sprintId)).length;
      const resetPlannedWorkItems: string[] = [];

      for (const item of state.workItems) {
        if (item.sprintId && sprintIds.has(item.sprintId)) {
          if (item.status === 'planned') {
            item.status = 'ready';
            resetPlannedWorkItems.push(item.id);
          }
          delete item.sprintId;
        }
      }

      state.sprints = state.sprints.filter((sprint) => !sprintIds.has(sprint.id));
      state.revisions = state.revisions.filter((revision) => !sprintIds.has(revision.sprintId));
      state.sprintItems = state.sprintItems.filter((membership) => !sprintIds.has(membership.sprintId));
      state.sprintEvidence = state.sprintEvidence.filter((evidence) => !sprintIds.has(evidence.sprintId));

      return {
        removedSprintIds,
        removedRevisionIds,
        removedMemberships,
        removedSprintEvidence,
        resetPlannedWorkItems,
      };
    },
    (summary) => summary,
    clock,
  );

const readyQueue = (
  root: string,
  sprintId: string,
  projectId?: string,
): Array<{ id: string; title: string; projectId: string; epicId?: string; whyReady: string[] }> => {
  const state = readState(root);
  const sprint = requireSprint(state, sprintId);
  if (sprint.status !== 'active') throw new ThemisError(`${sprintId} is not active`);
  if (projectId && sprint.projectId !== projectId)
    throw new ThemisError(`${sprintId} does not belong to project ${projectId}`);
  const membershipIds = new Set(sprintMemberships(state, sprintId).map((membership) => membership.workItemId));
  return state.workItems
    .filter((item) => membershipIds.has(item.id) && item.projectId === sprint.projectId && item.status === 'planned')
    .map((item) => ({ item, blockers: blockingDependencies(state, item.id) }))
    .filter(({ blockers }) => blockers.length === 0)
    .map(({ item }) => ({
      id: item.id,
      title: item.title,
      projectId: item.projectId,
      epicId: item.epicId,
      whyReady: ['sprint is active', 'dependencies are complete', 'no open run exists', 'verification strategy exists'],
    }));
};

const flowReadyQueue = (
  root: string,
  projectId: string,
  wipLimit?: number,
): Array<{ id: string; title: string; projectId: string; epicId?: string; whyReady: string[] }> => {
  const state = readState(root);
  requireProject(state, projectId);
  const activeWork = state.workItems.filter(
    (item) =>
      item.projectId === projectId &&
      (item.status === 'claimed' || item.status === 'in_progress' || item.status === 'review'),
  ).length;
  if (wipLimit !== undefined && (!Number.isInteger(wipLimit) || wipLimit < 1)) {
    throw new ThemisError('WIP limit must be a positive integer');
  }
  if (wipLimit !== undefined && activeWork >= wipLimit) return [];
  return state.workItems
    .filter((item) => item.projectId === projectId && (item.status === 'ready' || item.status === 'planned'))
    .map((item) => ({ item, blockers: blockingDependencies(state, item.id) }))
    .filter(({ blockers }) => blockers.length === 0)
    .slice(0, wipLimit === undefined ? undefined : wipLimit - activeWork)
    .map(({ item }) => ({
      id: item.id,
      title: item.title,
      projectId: item.projectId,
      epicId: item.epicId,
      whyReady: [
        'project flow is active',
        'dependencies are complete',
        'no open run exists',
        'verification strategy exists',
      ],
    }));
};

const validateState = (root: string): { valid: boolean; errors: string[]; counts: Record<string, number> } => {
  const state = readState(root);
  const errors: string[] = [];
  const projectIds = new Set(state.projects.map((project) => project.id));
  const epicIds = new Set(state.epics.map((epic) => epic.id));
  const workItemIds = new Set(state.workItems.map((item) => item.id));
  const sprintIds = new Set(state.sprints.map((sprint) => sprint.id));
  const runIds = new Set(state.runs.map((run) => run.id));
  const reviewIds = new Set(state.reviews.map((review) => review.id));

  for (const epic of state.epics) {
    if (!projectIds.has(epic.projectId)) errors.push(`${epic.id} references missing project ${epic.projectId}`);
  }
  for (const sprint of state.sprints) {
    if (!projectIds.has(sprint.projectId)) errors.push(`${sprint.id} references missing project ${sprint.projectId}`);
  }
  for (const dependency of state.dependencies) {
    if (!workItemIds.has(dependency.from)) errors.push(`Dependency source not found: ${dependency.from}`);
    if (!workItemIds.has(dependency.to)) errors.push(`Dependency target not found: ${dependency.to}`);
  }
  for (const item of state.workItems) {
    if (!projectIds.has(item.projectId)) errors.push(`${item.id} references missing project ${item.projectId}`);
    if (item.epicId && !epicIds.has(item.epicId)) errors.push(`${item.id} references missing epic ${item.epicId}`);
    if (item.epicId && state.epics.find((epic) => epic.id === item.epicId)?.projectId !== item.projectId) {
      errors.push(`${item.id} crosses its epic project boundary`);
    }
    if (item.sprintId && !sprintIds.has(item.sprintId))
      errors.push(`${item.id} references missing sprint ${item.sprintId}`);
  }
  for (const membership of state.sprintItems) {
    if (!sprintIds.has(membership.sprintId)) errors.push(`Membership references missing sprint ${membership.sprintId}`);
    if (!workItemIds.has(membership.workItemId))
      errors.push(`Membership references missing work item ${membership.workItemId}`);
    const sprint = state.sprints.find((candidate) => candidate.id === membership.sprintId);
    const item = state.workItems.find((candidate) => candidate.id === membership.workItemId);
    if (sprint && item && sprint.projectId !== item.projectId)
      errors.push(`${membership.workItemId} crosses its sprint project boundary`);
  }
  for (const project of state.projects) {
    if (state.sprints.filter((sprint) => sprint.projectId === project.id && sprint.status === 'active').length > 1) {
      errors.push(`${project.id} has more than one active sprint`);
    }
  }
  for (const evidence of state.evidence) {
    if (!runIds.has(evidence.runId)) errors.push(`${evidence.id} references missing run ${evidence.runId}`);
  }
  for (const evidence of state.sprintEvidence) {
    if (!sprintIds.has(evidence.sprintId)) errors.push(`${evidence.id} references missing sprint ${evidence.sprintId}`);
  }
  for (const review of state.reviews) {
    if (!runIds.has(review.runId)) errors.push(`${review.id} references missing run ${review.runId}`);
  }
  for (const reviewId of reviewIds) {
    if (!reviewId.startsWith('REVW-')) errors.push(`Invalid review id: ${reviewId}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    counts: {
      workItems: state.workItems.length,
      projects: state.projects.length,
      epics: state.epics.length,
      dependencies: state.dependencies.length,
      sprints: state.sprints.length,
      sprintItems: state.sprintItems.length,
      revisions: state.revisions.length,
      runs: state.runs.length,
      evidence: state.evidence.length,
      sprintEvidence: state.sprintEvidence.length,
      reviews: state.reviews.length,
    },
  };
};

const listProjects = (root: string): Project[] => readState(root).projects;

const listWorkItems = (
  root: string,
  filters: { projectId?: string; epicId?: string; sprintId?: string } = {},
): WorkItem[] => {
  const state = readState(root);
  const sprintWorkItemIds = filters.sprintId
    ? new Set(sprintMemberships(state, filters.sprintId).map((membership) => membership.workItemId))
    : undefined;
  return state.workItems.filter(
    (item) =>
      (!filters.projectId || item.projectId === filters.projectId) &&
      (!filters.epicId || item.epicId === filters.epicId) &&
      (!sprintWorkItemIds || sprintWorkItemIds.has(item.id)),
  );
};

const listEpics = (root: string, projectId?: string): Epic[] => {
  const state = readState(root);
  return projectId ? state.epics.filter((epic) => epic.projectId === projectId) : state.epics;
};

const listSprints = (root: string, projectId?: string): Sprint[] => {
  const state = readState(root);
  return projectId ? state.sprints.filter((sprint) => sprint.projectId === projectId) : state.sprints;
};

const timeline = (root: string, projectId?: string): TimelineEntry[] => {
  const events = readEvents(root);
  if (!projectId) return events;
  const state = readState(root);
  const projectEntityIds = new Set<string>([projectId]);
  state.epics.filter((epic) => epic.projectId === projectId).forEach((epic) => projectEntityIds.add(epic.id));
  state.workItems.filter((item) => item.projectId === projectId).forEach((item) => projectEntityIds.add(item.id));
  state.sprints.filter((sprint) => sprint.projectId === projectId).forEach((sprint) => projectEntityIds.add(sprint.id));
  state.revisions
    .filter((revision) => revision.projectId === projectId)
    .forEach((revision) => projectEntityIds.add(revision.id));
  state.runs.filter((run) => projectEntityIds.has(run.workItemId)).forEach((run) => projectEntityIds.add(run.id));
  state.reviews
    .filter((review) => projectEntityIds.has(review.workItemId))
    .forEach((review) => projectEntityIds.add(review.id));
  return events.filter((event) => {
    const payloadIds = Object.values(event.payload).filter((value): value is string => typeof value === 'string');
    return projectEntityIds.has(event.aggregateId) || payloadIds.some((id) => projectEntityIds.has(id));
  });
};

const portfolio = (
  root: string,
): Array<{
  project: Project;
  activeSprint?: Sprint;
  lastClosedSprint?: Sprint;
  epics: number;
  workItems: number;
  ready: number;
  blocked: number;
}> => {
  const state = readState(root);
  return state.projects.map((project) => {
    const activeSprint = state.sprints.find((sprint) => sprint.projectId === project.id && sprint.status === 'active');
    const lastClosedSprint = state.sprints
      .filter((sprint) => sprint.projectId === project.id && sprint.status === 'closed')
      .sort((left, right) => (right.closedAt ?? '').localeCompare(left.closedAt ?? ''))[0];
    const workItems = state.workItems.filter((item) => item.projectId === project.id);
    const ready = flowReadyQueue(root, project.id).length;
    return {
      project,
      activeSprint,
      lastClosedSprint,
      epics: state.epics.filter((epic) => epic.projectId === project.id).length,
      workItems: workItems.length,
      ready,
      blocked: workItems.filter((item) => item.status === 'blocked').length,
    };
  });
};

const claimWorkItem = (
  root: string,
  id: string,
  agent: string,
  actor = `agent:${agent}`,
  clock: Clock = defaultClock,
): WorkItem =>
  mutate(
    root,
    actor,
    'workitem.claimed',
    'work_item',
    id,
    (state) => {
      const item = requireWorkItem(state, id);
      if (item.status !== 'ready' && item.status !== 'planned')
        throw new ThemisError(`${id} cannot be claimed from ${item.status}`);
      const blockers = blockingDependencies(state, id);
      if (blockers.length > 0)
        throw new ThemisError(`${id} is blocked by: ${blockers.map((blocker) => blocker.id).join(', ')}`);
      if (state.runs.some((run) => run.workItemId === id && run.status === 'running'))
        throw new ThemisError(`${id} already has an open run`);
      item.status = 'claimed';
      item.claimedBy = agent;
      item.claimedAt = clock();
      return item;
    },
    (item) => ({ agent: item.claimedBy ?? actor, status: item.status }),
    clock,
  );

const startRun = (
  root: string,
  workItemId: string,
  agent: string,
  actor = `agent:${agent}`,
  clock: Clock = defaultClock,
): AgentRun =>
  mutate(
    root,
    actor,
    'run.started',
    'work_item',
    workItemId,
    (state) => {
      const item = requireWorkItem(state, workItemId);
      if (item.status !== 'claimed') throw new ThemisError(`${workItemId} must be claimed before starting a run`);
      const run: AgentRun = {
        id: nextId(
          'RUN',
          state.runs.map((candidate) => candidate.id),
        ),
        workItemId,
        agent,
        status: 'running',
        startedAt: clock(),
      };
      item.status = 'in_progress';
      state.runs.push(run);
      return run;
    },
    (run) => ({ runId: run.id, workItemId: run.workItemId, status: run.status }),
    clock,
  );

const finishRun = (
  root: string,
  runId: string,
  status: Exclude<RunStatus, 'running'>,
  terminationReason: string,
  actor = 'agent:verifier',
  clock: Clock = defaultClock,
): AgentRun =>
  mutate(
    root,
    actor,
    'run.finished',
    'run',
    runId,
    (state) => {
      const run = requireRun(state, runId);
      if (run.status !== 'running') throw new ThemisError(`${runId} is already ${run.status}`);
      run.status = status;
      run.terminationReason = terminationReason;
      run.finishedAt = clock();
      return run;
    },
    (run) => ({ workItemId: run.workItemId, status: run.status, terminationReason: run.terminationReason }),
    clock,
  );

const addEvidence = (
  root: string,
  runId: string,
  kind: EvidenceKind,
  summary: string,
  value: string,
  actor = 'agent:verifier',
  clock: Clock = defaultClock,
): Evidence =>
  mutate(
    root,
    actor,
    'evidence.added',
    'run',
    runId,
    (state) => {
      const run = requireRun(state, runId);
      if (run.status === 'failed') throw new ThemisError(`${runId} cannot receive evidence after failure`);
      const evidence: Evidence = {
        id: nextId(
          'EVD',
          state.evidence.map((entry) => entry.id),
        ),
        runId,
        kind,
        summary,
        value,
        createdAt: clock(),
      };
      state.evidence.push(evidence);
      return evidence;
    },
    (evidence) => ({ evidenceId: evidence.id, kind: evidence.kind }),
    clock,
  );

const requestReview = (
  root: string,
  workItemId: string,
  reviewer: string,
  actor = 'agent:executor',
  clock: Clock = defaultClock,
): Review =>
  mutate(
    root,
    actor,
    'review.requested',
    'work_item',
    workItemId,
    (state) => {
      const item = requireWorkItem(state, workItemId);
      if (item.status !== 'in_progress') throw new ThemisError(`${workItemId} must be in progress before review`);
      if (state.runs.some((candidate) => candidate.workItemId === workItemId && candidate.status === 'running'))
        throw new ThemisError(`${workItemId} has a running execution`);
      const run = state.runs
        .filter((candidate) => candidate.workItemId === workItemId && candidate.status === 'completed')
        .at(-1);
      if (!run) throw new ThemisError(`${workItemId} has no completed run`);
      const evidence = state.evidence.filter((entry) => entry.runId === run.id);
      if (!evidence.some((entry) => entry.kind === 'verification'))
        throw new ThemisError(`${workItemId} is missing verification evidence`);
      if (!evidence.some((entry) => entry.kind === 'implementation-diff'))
        throw new ThemisError(`${workItemId} is missing implementation-diff evidence`);
      item.status = 'review';
      const review: Review = {
        id: nextId(
          'REVW',
          state.reviews.map((candidate) => candidate.id),
        ),
        workItemId,
        runId: run.id,
        reviewer,
        createdAt: clock(),
      };
      state.reviews.push(review);
      return review;
    },
    (review) => ({ reviewId: review.id, workItemId: review.workItemId, reviewer: review.reviewer }),
    clock,
  );

const submitReview = (
  root: string,
  reviewId: string,
  verdict: ReviewVerdict,
  feedback: string,
  actor = 'agent:reviewer',
  clock: Clock = defaultClock,
): Review =>
  mutate(
    root,
    actor,
    'review.submitted',
    'review',
    reviewId,
    (state) => {
      const review = state.reviews.find((candidate) => candidate.id === reviewId);
      if (!review) throw new ThemisError(`Review not found: ${reviewId}`);
      if (review.verdict) throw new ThemisError(`${reviewId} already has a verdict`);
      const item = requireWorkItem(state, review.workItemId);
      review.verdict = verdict;
      review.feedback = feedback;
      review.decidedAt = clock();
      item.status = verdict === 'accepted' ? 'done' : 'rework';
      return review;
    },
    (review) => ({ verdict: review.verdict, workItemId: review.workItemId, feedback: review.feedback }),
    clock,
  );

export {
  addDependency,
  addEvidence,
  addSprintEvidence,
  approveSprint,
  activateSprint,
  claimWorkItem,
  closeSprint,
  createWorkItem,
  updateWorkItem,
  createEpic,
  createProject,
  finishRun,
  listEpics,
  listProjects,
  listSprints,
  listWorkItems,
  paths,
  portfolio,
  proposeSprint,
  readState,
  readyQueue,
  flowReadyQueue,
  requestReview,
  removeSprints,
  startRun,
  submitReview,
  timeline,
  transitionWorkItem,
  validateState,
  workspaceStatus,
  ThemisError,
};

export type {
  AgentRun,
  Dependency,
  Epic,
  EpicStatus,
  Evidence,
  EvidenceKind,
  Project,
  ProjectStatus,
  Review,
  ReviewVerdict,
  Sprint,
  SprintEvidence,
  SprintEvidenceKind,
  SprintRemovalSummary,
  SprintMembership,
  SprintRevision,
  ThemisState,
  TimelineEntry,
  WorkspaceStatus,
  WorkItem,
  WorkItemStatus,
  WorkItemUpdate,
};
