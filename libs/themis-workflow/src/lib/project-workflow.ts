import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

import {
  addDependency,
  addEvidence,
  addSprintEvidence,
  approveSprint,
  activateSprint,
  claimWorkItem,
  closeSprint,
  createEpic,
  createProject,
  createWorkItem,
  finishRun,
  flowReadyQueue,
  listEpics,
  listProjects,
  listSprints,
  listWorkItems,
  portfolio,
  proposeSprint,
  readState,
  readyQueue,
  removeSprints,
  requestReview,
  startRun,
  submitReview,
  timeline,
  transitionWorkItem,
  updateWorkItem,
  validateState,
  workspaceStatus,
} from './legacy-workflow-internal.ts';
import type {
  Epic,
  Project,
  Sprint,
  ThemisState,
  TimelineEntry,
  WorkspaceStatus,
  WorkItem,
} from './legacy-workflow-internal.ts';

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

const registryFile = (root: string): string => join(root, '.themis', 'registry.json');
const validProjectId = (projectId: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(projectId);
const projectDirectory = (root: string, projectId: string): string => {
  if (!validProjectId(projectId)) throw new WorkflowError(`Invalid project id: ${projectId}`, 'INVALID_PROJECT_ID');
  const projectsRoot = resolve(root, '.themis', 'projects');
  const directory = resolve(projectsRoot, projectId);
  if (directory !== join(projectsRoot, projectId) || !directory.startsWith(`${projectsRoot}/`)) {
    throw new WorkflowError(`Invalid project store path for ${projectId}`, 'INVALID_PROJECT_ID');
  }
  return directory;
};
const stableHash = (value: string): string => createHash('sha256').update(value).digest('hex');
const now = (): string => new Date().toISOString();
const atomicWrite = (file: string, value: unknown): void => {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
};

type RegistryData = { schemaVersion: 1; registrations: ProjectRegistration[] };
const readRegistry = (root: string): RegistryData => {
  const file = registryFile(root);
  if (!existsSync(file)) return { schemaVersion: 1, registrations: [] };
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as RegistryData;
    if (value.schemaVersion !== 1 || !Array.isArray(value.registrations)) throw new Error('invalid registry');
    return value;
  } catch {
    throw new WorkflowError(`Registry is corrupt: ${file}`, 'CORRUPT_STORE');
  }
};

/** Explicit registry only: this module deliberately has no directory traversal or discovery API. */
export class WorkspaceRegistry {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  root(): string {
    return this.workspaceRoot;
  }

  list(includeDisabled = false): PortableProjectIdentity[] {
    return readRegistry(this.workspaceRoot)
      .registrations.filter((entry) => includeDisabled || entry.status === 'active')
      .map(({ projectId, name, status }) => ({ projectId, name, status }));
  }

  register(projectId: string, name: string, rootPath: string): PortableProjectIdentity {
    if (!projectId || !name || !rootPath)
      throw new WorkflowError('Project registration requires id, name, and root', 'UNKNOWN_PROJECT');
    if (!validProjectId(projectId)) throw new WorkflowError(`Invalid project id: ${projectId}`, 'INVALID_PROJECT_ID');
    const data = readRegistry(this.workspaceRoot);
    const timestamp = now();
    const existing = data.registrations.find((entry) => entry.projectId === projectId);
    const record: ProjectRegistration = {
      projectId,
      name,
      status: 'active',
      locatorHash: stableHash(resolve(rootPath)),
      rootPath: resolve(rootPath),
      registeredAt: existing?.registeredAt ?? timestamp,
      updatedAt: timestamp,
    };
    if (existing) Object.assign(existing, record);
    else data.registrations.push(record);
    atomicWrite(registryFile(this.workspaceRoot), data);
    return { projectId, name, status: 'active' };
  }

  update(projectId: string, patch: { name?: string; rootPath?: string }): PortableProjectIdentity {
    const data = readRegistry(this.workspaceRoot);
    const record = data.registrations.find((entry) => entry.projectId === projectId);
    if (!record) throw new WorkflowError(`Unknown registered project: ${projectId}`, 'UNKNOWN_PROJECT');
    if (patch.name) record.name = patch.name;
    if (patch.rootPath) {
      record.rootPath = resolve(patch.rootPath);
      record.locatorHash = stableHash(record.rootPath);
    }
    record.updatedAt = now();
    atomicWrite(registryFile(this.workspaceRoot), data);
    return { projectId, name: record.name, status: record.status };
  }

  disable(projectId: string): PortableProjectIdentity {
    return this.setStatus(projectId, 'disabled');
  }

  remove(projectId: string): void {
    const data = readRegistry(this.workspaceRoot);
    const before = data.registrations.length;
    data.registrations = data.registrations.filter((entry) => entry.projectId !== projectId);
    if (data.registrations.length === before)
      throw new WorkflowError(`Unknown registered project: ${projectId}`, 'UNKNOWN_PROJECT');
    atomicWrite(registryFile(this.workspaceRoot), data);
  }

  resolve(projectId: string): ProjectRegistration {
    const record = readRegistry(this.workspaceRoot).registrations.find((entry) => entry.projectId === projectId);
    if (!record) throw new WorkflowError(`Unknown registered project: ${projectId}`, 'UNKNOWN_PROJECT');
    if (record.status !== 'active') throw new WorkflowError(`Project is disabled: ${projectId}`, 'PROJECT_DISABLED');
    if (!existsSync(record.rootPath) || stableHash(resolve(record.rootPath)) !== record.locatorHash)
      throw new WorkflowError(`Project root moved: ${projectId}`, 'MOVED_ROOT');
    return record;
  }

  private setStatus(projectId: string, status: ProjectRegistrationStatus): PortableProjectIdentity {
    const data = readRegistry(this.workspaceRoot);
    const record = data.registrations.find((entry) => entry.projectId === projectId);
    if (!record) throw new WorkflowError(`Unknown registered project: ${projectId}`, 'UNKNOWN_PROJECT');
    record.status = status;
    record.updatedAt = now();
    atomicWrite(registryFile(this.workspaceRoot), data);
    return { projectId, name: record.name, status };
  }
}

const sleep = (milliseconds: number): void => {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
};

const withFilesystemLock = <T>(file: string, operation: () => T): T => {
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + 2_000;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(file, 'wx');
      writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(file).mtimeMs > 30_000) unlinkSync(file);
      } catch {
        // The owner may be rotating the lock file.
      }
      if (Date.now() >= deadline) throw new WorkflowError(`Project lock contention: ${file}`, 'LOCKED');
      sleep(5);
    }
  }
  try {
    return operation();
  } finally {
    closeSync(descriptor);
    unlinkSync(file);
  }
};

/** Project-local append-only persistence with an OS-backed authority lock and cursor seam. */
export class ProjectWorkflowStore {
  private readonly registration: ProjectRegistration;
  private readonly directory: string;
  private readonly registry: WorkspaceRegistry;

  constructor(registry: WorkspaceRegistry, projectId: string) {
    this.registry = registry;
    this.registration = registry.resolve(projectId);
    this.directory = projectDirectory(registry.root(), projectId);
    if (existsSync(join(registry.root(), '.themis', 'state.json')) && !existsSync(join(this.directory, 'state.json'))) {
      throw new WorkflowError(`Project ${projectId} requires the PZS-002 migration cutover`, 'MIGRATION_REQUIRED');
    }
  }

  identity(): PortableProjectIdentity {
    const { projectId, name, status } = this.registration;
    return { projectId, name, status };
  }

  private assertHealthy(): void {
    try {
      readState(this.directory);
    } catch {
      throw new WorkflowError(`Corrupt project store for ${this.registration.projectId}`, 'CORRUPT_STORE');
    }
  }

  private scopedEntity(entityId: string, kind: string): void {
    const state = readState(this.directory);
    const projectId = this.registration.projectId;
    const matches =
      (kind === 'project' && state.projects.some((project) => project.id === entityId && project.id === projectId)) ||
      (kind === 'epic' && state.epics.some((epic) => epic.id === entityId && epic.projectId === projectId)) ||
      (kind === 'workItem' && state.workItems.some((item) => item.id === entityId && item.projectId === projectId)) ||
      (kind === 'sprint' && state.sprints.some((sprint) => sprint.id === entityId && sprint.projectId === projectId)) ||
      (kind === 'run' &&
        state.runs.some(
          (run) =>
            run.id === entityId &&
            state.workItems.some((item) => item.id === run.workItemId && item.projectId === projectId),
        )) ||
      (kind === 'review' &&
        state.reviews.some(
          (review) =>
            review.id === entityId &&
            state.workItems.some((item) => item.id === review.workItemId && item.projectId === projectId),
        ));
    if (!matches) throw new WorkflowError(`${kind} is outside project ${projectId}`, 'UNKNOWN_PROJECT');
  }

  private scopedState(): ThemisState {
    const state = readState(this.directory);
    const projectId = this.registration.projectId;
    const projectIds = new Set([projectId]);
    const epics = state.epics.filter((epic) => epic.projectId === projectId);
    const workItems = state.workItems.filter((item) => item.projectId === projectId);
    const sprints = state.sprints.filter((sprint) => sprint.projectId === projectId);
    const workItemIds = new Set(workItems.map((item) => item.id));
    const sprintIds = new Set(sprints.map((sprint) => sprint.id));
    const runIds = new Set(state.runs.filter((run) => workItemIds.has(run.workItemId)).map((run) => run.id));
    return {
      ...state,
      projects: state.projects.filter((project) => projectIds.has(project.id)),
      epics,
      workItems,
      dependencies: state.dependencies.filter(
        (dependency) => workItemIds.has(dependency.from) && workItemIds.has(dependency.to),
      ),
      sprints,
      sprintItems: state.sprintItems.filter(
        (membership) => sprintIds.has(membership.sprintId) && workItemIds.has(membership.workItemId),
      ),
      revisions: state.revisions.filter((revision) => revision.projectId === projectId),
      runs: state.runs.filter((run) => runIds.has(run.id)),
      evidence: state.evidence.filter((evidence) => runIds.has(evidence.runId)),
      sprintEvidence: state.sprintEvidence.filter((evidence) => sprintIds.has(evidence.sprintId)),
      reviews: state.reviews.filter((review) => workItemIds.has(review.workItemId) && runIds.has(review.runId)),
    };
  }

  append(type: string, actor: string, payload: Record<string, unknown>): WorkflowEvent {
    const key = this.registration.projectId;
    return withFilesystemLock(join(this.directory, '.project.lock'), () => {
      mkdirSync(this.directory, { recursive: true });
      const eventsFile = join(this.directory, 'events.ndjson');
      const events = this.events();
      const event: WorkflowEvent = {
        eventId: randomUUID(),
        projectId: key,
        sequence: (events.at(-1)?.sequence ?? 0) + 1,
        type,
        timestamp: now(),
        actor,
        payload,
      };
      appendFileSync(eventsFile, `${JSON.stringify(event)}\n`, 'utf8');
      return event;
    });
  }

  events(after = 0): WorkflowEvent[] {
    const file = join(this.directory, 'events.ndjson');
    if (!existsSync(file)) return [];
    try {
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as WorkflowEvent)
        .filter((event) => event.projectId === this.registration.projectId && event.sequence > after);
    } catch {
      throw new WorkflowError(`Malformed event store for ${this.registration.projectId}`, 'CORRUPT_STORE');
    }
  }

  cursor(): WorkflowCursor {
    const event = this.events().at(-1);
    return { projectId: this.registration.projectId, sequence: event?.sequence ?? 0, eventId: event?.eventId };
  }

  snapshot(state: unknown): WorkflowSnapshot {
    return withFilesystemLock(join(this.directory, '.project.lock'), () => {
      const snapshot = {
        projectId: this.registration.projectId,
        sequence: this.cursor().sequence,
        state,
        createdAt: now(),
      };
      atomicWrite(join(this.directory, 'snapshot.json'), snapshot);
      return snapshot;
    });
  }

  /** Complete domain API bound to this registered project store; no root fallback is possible. */
  domain(): ProjectDomain {
    const root = this.directory;
    const projectId = this.registration.projectId;
    const locked = <T>(operation: () => T): T => withFilesystemLock(join(root, '.project.lock'), operation);
    const healthy = (): void => this.assertHealthy();
    return {
      addDependency: (from, to, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(from, 'workItem');
          this.scopedEntity(to, 'workItem');
          return addDependency(root, from, to, actor, clock);
        }),
      addEvidence: (runId, kind, summary, value, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(runId, 'run');
          return addEvidence(root, runId, kind, summary, value, actor, clock);
        }),
      addSprintEvidence: (sprintId, kind, summary, value, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(sprintId, 'sprint');
          return addSprintEvidence(root, sprintId, kind, summary, value, actor, clock);
        }),
      approveSprint: (sprintId, revisionId, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(sprintId, 'sprint');
          return approveSprint(root, sprintId, revisionId, actor, clock);
        }),
      activateSprint: (sprintId, revisionId, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(sprintId, 'sprint');
          return activateSprint(root, sprintId, revisionId, actor, clock);
        }),
      claimWorkItem: (id, agent, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(id, 'workItem');
          return claimWorkItem(root, id, agent, actor, clock);
        }),
      closeSprint: (sprintId, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(sprintId, 'sprint');
          return closeSprint(root, sprintId, projectId, actor, clock);
        }),
      createEpic: (input, actor, clock) =>
        locked(() => {
          healthy();
          if (input.projectId && input.projectId !== projectId)
            throw new WorkflowError(`Epic is outside project ${projectId}`, 'UNKNOWN_PROJECT');
          return createEpic(root, { ...input, projectId }, actor, clock);
        }),
      createProject: (input, actor, clock) =>
        locked(() => {
          healthy();
          if (input.id !== projectId)
            throw new WorkflowError(`Project is outside project ${projectId}`, 'UNKNOWN_PROJECT');
          return createProject(root, { ...input, id: projectId }, actor, clock);
        }),
      createWorkItem: (input, actor, clock) =>
        locked(() => {
          healthy();
          if (input.projectId && input.projectId !== projectId)
            throw new WorkflowError(`Work item is outside project ${projectId}`, 'UNKNOWN_PROJECT');
          if (input.epicId) this.scopedEntity(input.epicId, 'epic');
          return createWorkItem(root, { ...input, projectId }, actor, clock);
        }),
      finishRun: (runId, status, reason, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(runId, 'run');
          return finishRun(root, runId, status, reason, actor, clock);
        }),
      flowReadyQueue: (wipLimit) => {
        healthy();
        return flowReadyQueue(root, projectId, wipLimit);
      },
      listEpics: () => {
        healthy();
        return listEpics(root, projectId);
      },
      listProjects: () => {
        healthy();
        return listProjects(root).filter((project) => project.id === projectId);
      },
      listSprints: () => {
        healthy();
        return listSprints(root, projectId);
      },
      listWorkItems: (filters) => {
        healthy();
        if (filters?.projectId && filters.projectId !== projectId)
          throw new WorkflowError(`Work-item filter is outside project ${projectId}`, 'UNKNOWN_PROJECT');
        if (filters?.epicId) this.scopedEntity(filters.epicId, 'epic');
        if (filters?.sprintId) this.scopedEntity(filters.sprintId, 'sprint');
        return listWorkItems(root, { ...filters, projectId });
      },
      portfolio: () => {
        healthy();
        return portfolio(root).filter((entry) => entry.project.id === projectId);
      },
      proposeSprint: (input, actor, clock) =>
        locked(() => {
          healthy();
          if (input.projectId && input.projectId !== projectId)
            throw new WorkflowError(`Sprint is outside project ${projectId}`, 'UNKNOWN_PROJECT');
          return proposeSprint(root, { ...input, projectId }, actor, clock);
        }),
      readState: () => {
        healthy();
        return this.scopedState();
      },
      readyQueue: (sprintId) => {
        this.scopedEntity(sprintId, 'sprint');
        return readyQueue(root, sprintId, projectId);
      },
      removeSprints: (actor, clock) =>
        locked(() => {
          healthy();
          return removeSprints(root, projectId, actor, clock);
        }),
      requestReview: (workItemId, reviewer, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(workItemId, 'workItem');
          return requestReview(root, workItemId, reviewer, actor, clock);
        }),
      startRun: (workItemId, agent, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(workItemId, 'workItem');
          return startRun(root, workItemId, agent, actor, clock);
        }),
      submitReview: (reviewId, verdict, feedback, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(reviewId, 'review');
          return submitReview(root, reviewId, verdict, feedback, actor, clock);
        }),
      timeline: () => {
        healthy();
        return timeline(root, projectId);
      },
      transitionWorkItem: (id, to, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(id, 'workItem');
          return transitionWorkItem(root, id, to, actor, clock);
        }),
      updateWorkItem: (id, patch, actor, clock) =>
        locked(() => {
          healthy();
          this.scopedEntity(id, 'workItem');
          return updateWorkItem(root, id, patch, actor, clock);
        }),
      validateState: () => {
        healthy();
        return validateState(root);
      },
      workspaceStatus: () => {
        healthy();
        return workspaceStatus(root);
      },
    };
  }
}

export type ProjectDomain = {
  addDependency: typeof addDependency extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  addEvidence: typeof addEvidence extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  addSprintEvidence: typeof addSprintEvidence extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  approveSprint: typeof approveSprint extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  activateSprint: typeof activateSprint extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  claimWorkItem: typeof claimWorkItem extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  closeSprint: (sprintId: string, actor?: string, clock?: () => string) => ReturnType<typeof closeSprint>;
  createEpic: typeof createEpic extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  createProject: typeof createProject extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  createWorkItem: typeof createWorkItem extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  finishRun: typeof finishRun extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  flowReadyQueue: (wipLimit?: number) => ReturnType<typeof flowReadyQueue>;
  listEpics: () => Epic[];
  listProjects: () => Project[];
  listSprints: () => Sprint[];
  listWorkItems: (filters?: Parameters<typeof listWorkItems>[1]) => WorkItem[];
  portfolio: () => ReturnType<typeof portfolio>;
  proposeSprint: typeof proposeSprint extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  readState: () => ThemisState;
  readyQueue: (sprintId: string) => ReturnType<typeof readyQueue>;
  removeSprints: (actor?: string, clock?: () => string) => ReturnType<typeof removeSprints>;
  requestReview: typeof requestReview extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  startRun: typeof startRun extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  submitReview: typeof submitReview extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  timeline: () => TimelineEntry[];
  transitionWorkItem: typeof transitionWorkItem extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  updateWorkItem: typeof updateWorkItem extends (root: string, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
  validateState: () => ReturnType<typeof validateState>;
  workspaceStatus: () => WorkspaceStatus;
};

export const redactPortable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactPortable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          ![
            'rootPath',
            'workspaceRoot',
            'locatorHash',
            'path',
            'secret',
            'key',
            'privateKey',
            'token',
            'password',
          ].includes(key),
      )
      .map(([key, entry]) => [key, redactPortable(entry)]),
  );
};

export const translateEvent = (
  event: WorkflowEvent,
): { activityType: string; projectId: string; sequence: number; auditEventId: string } => ({
  activityType: event.type.replaceAll('.', '_'),
  projectId: event.projectId,
  sequence: event.sequence,
  auditEventId: event.eventId,
});
