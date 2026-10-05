import { ThemisError } from './legacy-workflow-contract.ts';
import type {
  SprintProposalInput,
  Clock,
  SprintRevision,
  Sprint,
  SprintEvidenceKind,
  SprintEvidence,
  SprintRemovalSummary,
} from './legacy-workflow-contract.ts';
import {
  defaultClock,
  mutate,
  requireWorkItem,
  requireProject,
  requireEpic,
  nextId,
  requireSprint,
  requireFieldsForReady,
  itemSprintIds,
  sprintMemberships,
} from './legacy-workflow-storage.ts';

export const proposeSprint = (
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

      if (project.status !== 'active') {
        throw new ThemisError(`Project is not active: ${projectId}`);
      }
      for (const id of input.workItemIds) {
        const item = requireWorkItem(state, id);

        if (item.status !== 'ready') {
          throw new ThemisError(`${id} must be ready before sprint planning`);
        }
        if (item.projectId !== projectId) {
          throw new ThemisError(`${id} does not belong to project ${projectId}`);
        }
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

        if (epic.projectId !== projectId) {
          throw new ThemisError(`${epicId} does not belong to project ${projectId}`);
        }
      }
      const sprintId =
        input.sprintId ??
        nextId(
          'SPR',
          state.sprints.map((sprint) => sprint.id),
        );
      const sprint = state.sprints.find((candidate) => candidate.id === sprintId);

      if (sprint && sprint.status === 'active') {
        throw new ThemisError(`${sprintId} is already active`);
      }
      if (sprint && sprint.projectId !== projectId) {
        throw new ThemisError(`${sprintId} does not belong to project ${projectId}`);
      }
      if (!sprint) {
        state.sprints.push({ id: sprintId, projectId, goal: input.goal, status: 'proposed', createdAt: clock() });
      }
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

export const approveSprint = (
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

      if (project.status !== 'active') {
        throw new ThemisError(`Project is not active: ${project.id}`);
      }
      if (sprint.status !== 'proposed' && sprint.status !== 'draft') {
        throw new ThemisError(`${sprintId} cannot be approved from ${sprint.status}`);
      }
      const revision = state.revisions.find(
        (candidate) => candidate.id === revisionId && candidate.sprintId === sprintId,
      );

      if (!revision) {
        throw new ThemisError(`Revision not found: ${revisionId}`);
      }
      revision.status = 'approved';
      revision.approvedAt = clock();
      sprint.status = 'approved';

      return revision;
    },
    (revision) => ({ revisionId: revision.id, status: revision.status }),
    clock,
  );

export const activateSprint = (
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

      if (project.status !== 'active') {
        throw new ThemisError(`Project is not active: ${project.id}`);
      }
      const revision = state.revisions.find(
        (candidate) =>
          candidate.id === revisionId && candidate.sprintId === sprintId && candidate.status === 'approved',
      );

      if (!revision) {
        throw new ThemisError(`${revisionId} must be approved before activation`);
      }
      if (
        state.sprints.some((candidate) => candidate.projectId === sprint.projectId && candidate.status === 'active')
      ) {
        throw new ThemisError(`Project ${sprint.projectId} already has an active sprint`);
      }
      sprint.status = 'active';
      sprint.activeRevisionId = revisionId;
      for (const id of revision.workItemIds) {
        const item = requireWorkItem(state, id);

        if (item.status !== 'ready') {
          throw new ThemisError(`${id} must be ready before sprint activation`);
        }
        requireFieldsForReady(item);
        const activeMembership = itemSprintIds(state, id).find((membershipSprintId) =>
          state.sprints.some((candidate) => candidate.id === membershipSprintId && candidate.status === 'active'),
        );

        if (activeMembership) {
          throw new ThemisError(`${id} is already assigned to active sprint ${activeMembership}`);
        }
        state.sprintItems.push({ sprintId, workItemId: id, addedAt: clock() });
        item.sprintId = sprintId;
        item.status = 'planned';
      }

      return sprint;
    },
    (sprint) => ({ sprintId: sprint.id, revisionId, status: sprint.status }),
    clock,
  );

export const addSprintEvidence = (
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

      if (sprint.status !== 'active') {
        throw new ThemisError(`${sprintId} must be active before adding evidence`);
      }
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

export const closeSprint = (
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

      if (sprint.projectId !== projectId) {
        throw new ThemisError(`${sprintId} does not belong to project ${projectId}`);
      }
      if (sprint.status !== 'active') {
        throw new ThemisError(`${sprintId} cannot be closed from ${sprint.status}`);
      }
      const memberships = sprintMemberships(state, sprintId);
      const items = memberships.map(({ workItemId }) => requireWorkItem(state, workItemId));
      const unfinished = items.filter((item) => item.status !== 'done' && item.status !== 'cancelled');

      if (unfinished.length > 0) {
        throw new ThemisError(`Sprint has unfinished work: ${unfinished.map((item) => item.id).join(', ')}`);
      }
      const openRuns = state.runs.filter(
        (run) => memberships.some(({ workItemId }) => workItemId === run.workItemId) && run.status === 'running',
      );

      if (openRuns.length > 0) {
        throw new ThemisError(`Sprint has open runs: ${openRuns.map((run) => run.id).join(', ')}`);
      }
      const pendingReviews = state.reviews.filter(
        (review) => memberships.some(({ workItemId }) => workItemId === review.workItemId) && !review.verdict,
      );

      if (pendingReviews.length > 0) {
        throw new ThemisError(`Sprint has pending reviews: ${pendingReviews.map((review) => review.id).join(', ')}`);
      }
      const evidence = state.sprintEvidence.filter((entry) => entry.sprintId === sprintId);

      if (!evidence.some((entry) => entry.kind === 'verification')) {
        throw new ThemisError(`${sprintId} is missing final verification evidence`);
      }
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

export const removeSprints = (
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
