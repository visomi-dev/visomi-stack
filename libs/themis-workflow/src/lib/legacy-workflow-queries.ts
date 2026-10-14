import {
  readState,
  requireSprint,
  sprintMemberships,
  blockingDependencies,
  requireProject,
  readEvents,
} from './legacy-workflow-storage.ts';
import { ThemisError } from './legacy-workflow-contract.ts';
import type { Project, WorkItem, Epic, Sprint, TimelineEntry } from './legacy-workflow-contract.ts';

export const readyQueue = (
  root: string,
  sprintId: string,
  projectId?: string,
): Array<{ id: string; title: string; projectId: string; epicId?: string; whyReady: string[] }> => {
  const state = readState(root);
  const sprint = requireSprint(state, sprintId);

  if (sprint.status !== 'active') {
    throw new ThemisError(`${sprintId} is not active`);
  }
  if (projectId && sprint.projectId !== projectId) {
    throw new ThemisError(`${sprintId} does not belong to project ${projectId}`);
  }
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

export const flowReadyQueue = (
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
  if (wipLimit !== undefined && activeWork >= wipLimit) {
    return [];
  }

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

export const validateState = (root: string): { valid: boolean; errors: string[]; counts: Record<string, number> } => {
  const state = readState(root);
  const errors: string[] = [];
  const projectIds = new Set(state.projects.map((project) => project.id));
  const epicIds = new Set(state.epics.map((epic) => epic.id));
  const workItemIds = new Set(state.workItems.map((item) => item.id));
  const sprintIds = new Set(state.sprints.map((sprint) => sprint.id));
  const runIds = new Set(state.runs.map((run) => run.id));
  const reviewIds = new Set(state.reviews.map((review) => review.id));

  for (const epic of state.epics) {
    if (!projectIds.has(epic.projectId)) {
      errors.push(`${epic.id} references missing project ${epic.projectId}`);
    }
  }
  for (const sprint of state.sprints) {
    if (!projectIds.has(sprint.projectId)) {
      errors.push(`${sprint.id} references missing project ${sprint.projectId}`);
    }
  }
  for (const dependency of state.dependencies) {
    if (!workItemIds.has(dependency.from)) {
      errors.push(`Dependency source not found: ${dependency.from}`);
    }
    if (!workItemIds.has(dependency.to)) {
      errors.push(`Dependency target not found: ${dependency.to}`);
    }
  }
  for (const item of state.workItems) {
    if (!projectIds.has(item.projectId)) {
      errors.push(`${item.id} references missing project ${item.projectId}`);
    }
    if (item.epicId && !epicIds.has(item.epicId)) {
      errors.push(`${item.id} references missing epic ${item.epicId}`);
    }
    if (item.epicId && state.epics.find((epic) => epic.id === item.epicId)?.projectId !== item.projectId) {
      errors.push(`${item.id} crosses its epic project boundary`);
    }
    if (item.sprintId && !sprintIds.has(item.sprintId)) {
      errors.push(`${item.id} references missing sprint ${item.sprintId}`);
    }
  }
  for (const membership of state.sprintItems) {
    if (!sprintIds.has(membership.sprintId)) {
      errors.push(`Membership references missing sprint ${membership.sprintId}`);
    }
    if (!workItemIds.has(membership.workItemId)) {
      errors.push(`Membership references missing work item ${membership.workItemId}`);
    }
    const sprint = state.sprints.find((candidate) => candidate.id === membership.sprintId);
    const item = state.workItems.find((candidate) => candidate.id === membership.workItemId);

    if (sprint && item && sprint.projectId !== item.projectId) {
      errors.push(`${membership.workItemId} crosses its sprint project boundary`);
    }
  }
  for (const project of state.projects) {
    if (state.sprints.filter((sprint) => sprint.projectId === project.id && sprint.status === 'active').length > 1) {
      errors.push(`${project.id} has more than one active sprint`);
    }
  }
  for (const evidence of state.evidence) {
    if (!runIds.has(evidence.runId)) {
      errors.push(`${evidence.id} references missing run ${evidence.runId}`);
    }
  }
  for (const evidence of state.sprintEvidence) {
    if (!sprintIds.has(evidence.sprintId)) {
      errors.push(`${evidence.id} references missing sprint ${evidence.sprintId}`);
    }
  }
  for (const review of state.reviews) {
    if (!runIds.has(review.runId)) {
      errors.push(`${review.id} references missing run ${review.runId}`);
    }
  }
  for (const reviewId of reviewIds) {
    if (!reviewId.startsWith('REVW-')) {
      errors.push(`Invalid review id: ${reviewId}`);
    }
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

export const listProjects = (root: string): Project[] => readState(root).projects;

export const listWorkItems = (
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

export const listEpics = (root: string, projectId?: string): Epic[] => {
  const state = readState(root);

  return projectId ? state.epics.filter((epic) => epic.projectId === projectId) : state.epics;
};

export const listSprints = (root: string, projectId?: string): Sprint[] => {
  const state = readState(root);

  return projectId ? state.sprints.filter((sprint) => sprint.projectId === projectId) : state.sprints;
};

export const timeline = (root: string, projectId?: string): TimelineEntry[] => {
  const events = readEvents(root);

  if (!projectId) {
    return events;
  }
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

export const portfolio = (
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
