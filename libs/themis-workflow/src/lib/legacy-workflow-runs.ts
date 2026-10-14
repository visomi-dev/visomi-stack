import { ThemisError } from './legacy-workflow-contract.ts';
import type {
  Clock,
  WorkItem,
  AgentRun,
  RunStatus,
  EvidenceKind,
  Evidence,
  Review,
  ReviewVerdict,
} from './legacy-workflow-contract.ts';
import {
  defaultClock,
  mutate,
  requireWorkItem,
  blockingDependencies,
  nextId,
  requireRun,
} from './legacy-workflow-storage.ts';

export const claimWorkItem = (
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

      if (item.status !== 'ready' && item.status !== 'planned') {
        throw new ThemisError(`${id} cannot be claimed from ${item.status}`);
      }
      const blockers = blockingDependencies(state, id);

      if (blockers.length > 0) {
        throw new ThemisError(`${id} is blocked by: ${blockers.map((blocker) => blocker.id).join(', ')}`);
      }
      if (state.runs.some((run) => run.workItemId === id && run.status === 'running')) {
        throw new ThemisError(`${id} already has an open run`);
      }
      item.status = 'claimed';
      item.claimedBy = agent;
      item.claimedAt = clock();

      return item;
    },
    (item) => ({ agent: item.claimedBy ?? actor, status: item.status }),
    clock,
  );

export const startRun = (
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

      if (item.status !== 'claimed') {
        throw new ThemisError(`${workItemId} must be claimed before starting a run`);
      }
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

export const finishRun = (
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

      if (run.status !== 'running') {
        throw new ThemisError(`${runId} is already ${run.status}`);
      }
      run.status = status;
      run.terminationReason = terminationReason;
      run.finishedAt = clock();

      return run;
    },
    (run) => ({ workItemId: run.workItemId, status: run.status, terminationReason: run.terminationReason }),
    clock,
  );

export const addEvidence = (
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

      if (run.status === 'failed') {
        throw new ThemisError(`${runId} cannot receive evidence after failure`);
      }
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

export const requestReview = (
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

      if (item.status !== 'in_progress') {
        throw new ThemisError(`${workItemId} must be in progress before review`);
      }
      if (state.runs.some((candidate) => candidate.workItemId === workItemId && candidate.status === 'running')) {
        throw new ThemisError(`${workItemId} has a running execution`);
      }
      const run = state.runs
        .filter((candidate) => candidate.workItemId === workItemId && candidate.status === 'completed')
        .at(-1);

      if (!run) {
        throw new ThemisError(`${workItemId} has no completed run`);
      }
      const evidence = state.evidence.filter((entry) => entry.runId === run.id);

      if (!evidence.some((entry) => entry.kind === 'verification')) {
        throw new ThemisError(`${workItemId} is missing verification evidence`);
      }
      if (!evidence.some((entry) => entry.kind === 'implementation-diff')) {
        throw new ThemisError(`${workItemId} is missing implementation-diff evidence`);
      }
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

export const submitReview = (
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

      if (!review) {
        throw new ThemisError(`Review not found: ${reviewId}`);
      }
      if (review.verdict) {
        throw new ThemisError(`${reviewId} already has a verdict`);
      }
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
