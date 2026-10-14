import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { ThemisError } from './legacy-workflow-contract.ts';
import type {
  Clock,
  ThemisState,
  ThemisEvent,
  WorkspaceStatus,
  WorkItem,
  Sprint,
  Project,
  Epic,
  SprintMembership,
  AgentRun,
  WorkItemStatus,
} from './legacy-workflow-contract.ts';

export const defaultClock: Clock = () => new Date().toISOString();

export const emptyState = (): ThemisState => ({
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

export const paths = (root: string) => {
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

export const readEvents = (root: string): ThemisEvent[] => {
  const location = paths(root).events;

  if (!existsSync(location)) {
    return [];
  }

  return readFileSync(location, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ThemisEvent);
};

export const workspaceStatus = (root: string): WorkspaceStatus => {
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

export const migrateState = (raw: Partial<ThemisState>): ThemisState => {
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

export const readState = (root: string): ThemisState => {
  const location = paths(root);

  mkdirSync(location.directory, { recursive: true });
  if (!existsSync(location.state)) {
    const state = emptyState();

    writeFileSync(location.state, JSON.stringify(state, null, 2) + '\n', 'utf8');

    return state;
  }

  const raw = JSON.parse(readFileSync(location.state, 'utf8')) as Partial<ThemisState>;
  const state = migrateState(raw);

  if (raw.schemaVersion !== state.schemaVersion) {
    writeFileSync(location.state, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  return state;
};

export const writeState = (root: string, state: ThemisState): void => {
  const location = paths(root);
  const temporary = `${location.state}.tmp`;

  writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', 'utf8');
  renameSync(temporary, location.state);
};

export const nextId = (prefix: string, values: string[]): string => {
  const numbers = values
    .filter((value) => value.startsWith(`${prefix}-`))
    .map((value) => Number(value.slice(prefix.length + 1)))
    .filter((value) => Number.isInteger(value));
  const next = Math.max(0, ...numbers) + 1;

  return `${prefix}-${String(next).padStart(3, '0')}`;
};

export const appendEvent = (
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

export const requireWorkItem = (state: ThemisState, id: string): WorkItem => {
  const item = state.workItems.find((candidate) => candidate.id === id);

  if (!item) {
    throw new ThemisError(`Work item not found: ${id}`);
  }

  return item;
};

export const requireSprint = (state: ThemisState, id: string): Sprint => {
  const sprint = state.sprints.find((candidate) => candidate.id === id);

  if (!sprint) {
    throw new ThemisError(`Sprint not found: ${id}`);
  }

  return sprint;
};

export const requireProject = (state: ThemisState, id: string): Project => {
  const project = state.projects.find((candidate) => candidate.id === id);

  if (!project) {
    throw new ThemisError(`Project not found: ${id}`);
  }

  return project;
};

export const requireEpic = (state: ThemisState, id: string): Epic => {
  const epic = state.epics.find((candidate) => candidate.id === id);

  if (!epic) {
    throw new ThemisError(`Epic not found: ${id}`);
  }

  return epic;
};

export const ensureDefaultProject = (state: ThemisState, clock: Clock): Project => {
  const existing = state.projects.find((project) => project.id === 'PRJ-LOCAL');

  if (existing) {
    return existing;
  }
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

export const sprintMemberships = (state: ThemisState, sprintId: string): SprintMembership[] =>
  state.sprintItems.filter((membership) => membership.sprintId === sprintId);

export const itemSprintIds = (state: ThemisState, workItemId: string): string[] =>
  state.sprintItems
    .filter((membership) => membership.workItemId === workItemId)
    .map((membership) => membership.sprintId);

export const requireRun = (state: ThemisState, id: string): AgentRun => {
  const run = state.runs.find((candidate) => candidate.id === id);

  if (!run) {
    throw new ThemisError(`Run not found: ${id}`);
  }

  return run;
};

export const blockingDependencies = (state: ThemisState, itemId: string): WorkItem[] =>
  state.dependencies
    .filter((dependency) => dependency.to === itemId && dependency.relation === 'blocks')
    .map((dependency) => requireWorkItem(state, dependency.from))
    .filter((dependency) => dependency.status !== 'done');

export const requireFieldsForReady = (item: WorkItem): void => {
  const missing: string[] = [];

  if (item.acceptanceCriteria.length === 0) {
    missing.push('acceptance criteria');
  }
  if (item.scopeIn.length === 0) {
    missing.push('scope in');
  }
  if (item.verificationStrategy.length === 0) {
    missing.push('verification strategy');
  }
  if (missing.length > 0) {
    throw new ThemisError(`${item.id} cannot move to ready. Missing: ${missing.join(', ')}`);
  }
};

export const allowedTransitions: Record<WorkItemStatus, WorkItemStatus[]> = {
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

export const mutate = <T>(
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
