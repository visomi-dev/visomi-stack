import type { ThemisState } from '../libs/themis-workflow/src/lib/legacy-workflow-internal.ts';

import type { RecordAssignment, StoreState, ThemisEvent } from './themis-project-migration-contract.ts';

export const retargetProject = (
  state: ThemisState,
  events: ThemisEvent[],
  sourceProjectId: string,
  targetProjectId: string,
): { state: ThemisState; events: ThemisEvent[] } => {
  const replace = (value: unknown): unknown => (value === sourceProjectId ? targetProjectId : value);
  const nextState = JSON.parse(
    JSON.stringify(state).replaceAll(`"${sourceProjectId}"`, `"${targetProjectId}"`),
  ) as ThemisState;
  const nextEvents = events.map((event) => ({
    ...event,
    aggregateId: event.aggregateId === sourceProjectId ? targetProjectId : event.aggregateId,
    payload: Object.fromEntries(Object.entries(event.payload).map(([key, value]) => [key, replace(value)])),
  }));

  return { state: nextState, events: nextEvents };
};

export const idsForProject = (state: ThemisState, projectId: string): Set<string> => {
  const ids = new Set<string>([projectId]);

  state.epics.filter((entry) => entry.projectId === projectId).forEach((entry) => ids.add(entry.id));
  state.workItems.filter((entry) => entry.projectId === projectId).forEach((entry) => ids.add(entry.id));
  state.sprints.filter((entry) => entry.projectId === projectId).forEach((entry) => ids.add(entry.id));
  state.revisions.filter((entry) => entry.projectId === projectId).forEach((entry) => ids.add(entry.id));
  state.runs.filter((entry) => ids.has(entry.workItemId)).forEach((entry) => ids.add(entry.id));
  state.reviews
    .filter((entry) => ids.has(entry.workItemId) || ids.has(entry.runId))
    .forEach((entry) => ids.add(entry.id));
  state.evidence.filter((entry) => ids.has(entry.runId)).forEach((entry) => ids.add(entry.id));
  state.sprintItems
    .filter((entry) => ids.has(entry.sprintId) || ids.has(entry.workItemId))
    .forEach((entry) => {
      ids.add(entry.sprintId);
      ids.add(entry.workItemId);
    });
  state.sprintEvidence.filter((entry) => ids.has(entry.sprintId)).forEach((entry) => ids.add(entry.id));

  return ids;
};

export const projectState = (state: ThemisState, projectId: string): StoreState => {
  const ids = idsForProject(state, projectId);

  return {
    schemaVersion: state.schemaVersion,
    projectId,
    projects: state.projects.filter((entry) => entry.id === projectId),
    epics: state.epics.filter((entry) => entry.projectId === projectId),
    workItems: state.workItems.filter((entry) => entry.projectId === projectId),
    dependencies: state.dependencies.filter((entry) => ids.has(entry.from) && ids.has(entry.to)),
    sprints: state.sprints.filter((entry) => entry.projectId === projectId),
    sprintItems: state.sprintItems.filter((entry) => ids.has(entry.sprintId) && ids.has(entry.workItemId)),
    revisions: state.revisions.filter((entry) => entry.projectId === projectId),
    runs: state.runs.filter((entry) => ids.has(entry.workItemId)),
    evidence: state.evidence.filter((entry) => ids.has(entry.runId)),
    sprintEvidence: state.sprintEvidence.filter((entry) => ids.has(entry.sprintId)),
    reviews: state.reviews.filter((entry) => ids.has(entry.workItemId) || ids.has(entry.runId)),
  };
};

export const recordAssignment = (state: ThemisState): Map<string, RecordAssignment> => {
  const assignments = new Map<string, RecordAssignment>();
  const projectIds = new Set(state.projects.map((project) => project.id));
  const assign = (kind: string, id: string, projectId: string | undefined, reason?: string): void => {
    assignments.set(`${kind}:${id}`, projectId ? { projectId } : { reason });
  };

  for (const record of state.projects) {
    assign('project', record.id, record.id);
  }
  for (const record of state.epics) {
    assign('epic', record.id, projectIds.has(record.projectId) ? record.projectId : undefined, 'missing-project');
  }
  for (const record of state.workItems) {
    assign('work-item', record.id, projectIds.has(record.projectId) ? record.projectId : undefined, 'missing-project');
  }
  for (const record of state.sprints) {
    assign('sprint', record.id, projectIds.has(record.projectId) ? record.projectId : undefined, 'missing-project');
  }
  for (const record of state.revisions) {
    assign('revision', record.id, projectIds.has(record.projectId) ? record.projectId : undefined, 'missing-project');
  }
  const projectOf = (kind: string, id: string): string | undefined => assignments.get(`${kind}:${id}`)?.projectId;

  for (const record of state.runs) {
    assign(
      'run',
      record.id,
      projectOf('work-item', record.workItemId),
      projectOf('work-item', record.workItemId) ? undefined : 'missing-work-item',
    );
  }
  for (const record of state.evidence) {
    assign(
      'evidence',
      record.id,
      projectOf('run', record.runId),
      projectOf('run', record.runId) ? undefined : 'missing-run',
    );
  }
  for (const record of state.sprintEvidence) {
    assign(
      'sprint-evidence',
      record.id,
      projectOf('sprint', record.sprintId),
      projectOf('sprint', record.sprintId) ? undefined : 'missing-sprint',
    );
  }
  for (const record of state.sprintItems) {
    const sprintProject = projectOf('sprint', record.sprintId);
    const itemProject = projectOf('work-item', record.workItemId);

    assign(
      'sprint-membership',
      `${record.sprintId}:${record.workItemId}`,
      sprintProject && sprintProject === itemProject ? sprintProject : undefined,
      sprintProject && itemProject ? 'cross-project-reference' : 'missing-reference',
    );
  }
  for (const record of state.reviews) {
    const workItemProject = projectOf('work-item', record.workItemId);
    const runProject = projectOf('run', record.runId);

    assign(
      'review',
      record.id,
      workItemProject && workItemProject === runProject ? workItemProject : undefined,
      workItemProject && runProject ? 'cross-project-reference' : 'missing-reference',
    );
  }
  for (const record of state.dependencies) {
    const fromProject = projectOf('work-item', record.from);
    const toProject = projectOf('work-item', record.to);

    assign(
      'dependency',
      `${record.from}->${record.to}`,
      fromProject && fromProject === toProject ? fromProject : undefined,
      fromProject && toProject ? 'cross-project-reference' : 'missing-reference',
    );
  }

  return assignments;
};

export const eventProject = (event: ThemisEvent, projectIds: Map<string, string>): string | undefined => {
  const candidates = [event.aggregateId, ...Object.values(event.payload)].filter(
    (value): value is string => typeof value === 'string',
  );
  const projects = new Set(candidates.map((id) => projectIds.get(id)).filter((id): id is string => id !== undefined));

  return projects.size === 1 ? [...projects][0] : undefined;
};
