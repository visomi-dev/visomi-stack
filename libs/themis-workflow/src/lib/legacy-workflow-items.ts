import { ThemisError } from './legacy-workflow-contract.ts';
import type {
  ProjectInput,
  Clock,
  Project,
  EpicInput,
  Epic,
  WorkItem,
  WorkItemUpdate,
  WorkItemStatus,
  Dependency,
} from './legacy-workflow-contract.ts';
import {
  defaultClock,
  mutate,
  requireProject,
  ensureDefaultProject,
  requireEpic,
  nextId,
  requireWorkItem,
  allowedTransitions,
  requireFieldsForReady,
  blockingDependencies,
} from './legacy-workflow-storage.ts';

export const createProject = (
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
      if (state.projects.some((project) => project.id === input.id)) {
        throw new ThemisError(`Project already exists: ${input.id}`);
      }
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

export const createEpic = (
  root: string,
  input: EpicInput,
  actor = 'agent:planner',
  clock: Clock = defaultClock,
): Epic =>
  mutate(
    root,
    actor,
    'epic.created',
    'epic',
    input.id,
    (state) => {
      requireProject(state, input.projectId);
      if (state.epics.some((epic) => epic.id === input.id)) {
        throw new ThemisError(`Epic already exists: ${input.id}`);
      }
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

export const createWorkItem = (
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

      if (project.status !== 'active') {
        throw new ThemisError(`Project is not active: ${project.id}`);
      }
      if (input.epicId) {
        const epic = requireEpic(state, input.epicId);

        if (epic.projectId !== project.id) {
          throw new ThemisError(`${input.epicId} does not belong to project ${project.id}`);
        }
      }
      const id =
        input.id ??
        nextId(
          'THM',
          state.workItems.map((item) => item.id),
        );

      if (state.workItems.some((item) => item.id === id)) {
        throw new ThemisError(`Work item already exists: ${id}`);
      }
      const item: WorkItem = { ...input, id, projectId: project.id, status: 'draft' };

      state.workItems.push(item);

      return item;
    },
    (item) => ({ id: item.id, title: item.title, status: item.status }),
    clock,
  );

export const updateWorkItem = (
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

      if (changedFields.length === 0) {
        throw new ThemisError(`${id} update has no fields`);
      }

      if (patch.title !== undefined) {
        item.title = patch.title;
      }
      if (patch.summary !== undefined) {
        item.summary = patch.summary;
      }
      if (patch.acceptanceCriteria !== undefined) {
        item.acceptanceCriteria = patch.acceptanceCriteria;
      }
      if (patch.scopeIn !== undefined) {
        item.scopeIn = patch.scopeIn;
      }
      if (patch.scopeOut !== undefined) {
        item.scopeOut = patch.scopeOut;
      }
      if (patch.verificationStrategy !== undefined) {
        item.verificationStrategy = patch.verificationStrategy;
      }

      const previousStatus = item.status;

      if (previousStatus === 'done' || previousStatus === 'review') {
        item.status = 'rework';
      }

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

export const transitionWorkItem = (
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

      if (from === to) {
        throw new ThemisError(`${id} is already ${to}`);
      }
      if (!allowedTransitions[from].includes(to)) {
        throw new ThemisError(`${id} cannot move from ${from} to ${to}`);
      }
      if (to === 'ready') {
        requireFieldsForReady(item);
      }
      if (to === 'claimed' && blockingDependencies(state, id).length > 0) {
        throw new ThemisError(
          `${id} is blocked by: ${blockingDependencies(state, id)
            .map((dependency) => dependency.id)
            .join(', ')}`,
        );
      }
      if (to === 'review') {
        const run = state.runs.find((candidate) => candidate.workItemId === id && candidate.status === 'completed');

        if (!run) {
          throw new ThemisError(`${id} cannot move to review without a completed run`);
        }
        const evidence = state.evidence.filter((entry) => entry.runId === run.id);

        if (!evidence.some((entry) => entry.kind === 'verification')) {
          throw new ThemisError(`${id} cannot move to review. Missing evidence: verification`);
        }
        if (!evidence.some((entry) => entry.kind === 'implementation-diff')) {
          throw new ThemisError(`${id} cannot move to review. Missing evidence: implementation-diff`);
        }
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

export const addDependency = (
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
      if (from === to) {
        throw new ThemisError('A work item cannot block itself');
      }
      if (state.dependencies.some((dependency) => dependency.from === from && dependency.to === to)) {
        throw new ThemisError('Dependency already exists');
      }
      const dependency: Dependency = { from, to, relation: 'blocks' };

      state.dependencies.push(dependency);

      return dependency;
    },
    (dependency) => dependency,
    clock,
  );
