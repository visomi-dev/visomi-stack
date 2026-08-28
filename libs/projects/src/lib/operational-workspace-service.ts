import { and, eq } from 'drizzle-orm';
import { projects, withAccountContext } from 'shared';

import type {
  OperationalCollection,
  OperationalActivity,
  OperationalAuthority,
  OperationalEvidence,
  OperationalEpic,
  OperationalProject,
  OperationalReview,
  OperationalRun,
  OperationalWorkItem,
  OperationalWorkspaceReadModel,
} from './contracts/operational-workspace';

type OperationalFixtureState = 'visible' | 'empty' | 'locked' | 'unavailable' | 'stale' | 'error' | 'malformed';
type OperationalWorkspaceContext = {
  accountId: string;
  userId: string;
  fixtureState?: OperationalFixtureState;
  lifecycle?: string;
};

function collection<T>(
  source: string,
  observedAt: string,
  state: OperationalFixtureState,
  items: T[] = [],
  authority: OperationalAuthority = 'opaque-encrypted-source',
): OperationalCollection<T> {
  return {
    authority,
    items,
    state,
    source,
    observedAt,
    ...(state === 'empty' ? {} : { reason: `local-agent projection is ${state}` }),
  };
}

async function getOperationalWorkspace(
  context: OperationalWorkspaceContext,
  projectId: string,
): Promise<OperationalWorkspaceReadModel | null> {
  return withAccountContext(context, async (db) => {
    const [row] = await db
      .select({ id: projects.id, name: projects.name, status: projects.status, updatedAt: projects.updatedAt })
      .from(projects)
      .where(and(eq(projects.accountId, context.accountId), eq(projects.id, projectId)))
      .limit(1);

    if (!row) return null;

    const observedAt = new Date().toISOString();
    const project: OperationalProject = {
      id: row.id,
      name: row.name,
      status: row.status as OperationalProject['status'],
      visibility: 'operational',
      updatedAt: row.updatedAt.toISOString(),
    };
    const state = context.fixtureState ?? 'locked';
    const visibleItems = state === 'visible';
    const epic: OperationalEpic = {
      id: 'epic-fixture',
      projectId: row.id,
      title: 'Operational outcome',
      summary: null,
      status: 'active',
    };
    const workItem: OperationalWorkItem = {
      id: 'work-item-fixture',
      epicId: epic.id,
      title: 'Protected work item',
      status: ['draft', 'ready', 'in_progress', 'review', 'blocked', 'done'].includes(context.lifecycle ?? '')
        ? (context.lifecycle as OperationalWorkItem['status'])
        : 'in_progress',
      updatedAt: row.updatedAt.toISOString(),
      intent: 'Make the project state understandable without granting mutation authority.',
      scope: 'Read-only workspace, execution trace, validation evidence, and independent review context.',
      dependencies: ['Protected local-agent projection'],
      nextAction: 'Inspect the recorded evidence and review decision before taking any action elsewhere.',
    };
    const run: OperationalRun = {
      id: 'run-fixture',
      workItemId: workItem.id,
      status: 'running',
      startedAt: row.updatedAt.toISOString(),
      finishedAt: null,
    };
    const evidence: OperationalEvidence = {
      id: 'evidence-fixture',
      runId: run.id,
      kind: 'verification',
      createdAt: row.updatedAt.toISOString(),
      summary: 'Focused read-model and route validation recorded.',
      result: 'passed',
    };
    const review: OperationalReview = {
      id: 'review-fixture',
      workItemId: workItem.id,
      verdict: ['accepted', 'rejected', 'pending', 'rework'].includes(context.lifecycle ?? '')
        ? (context.lifecycle as OperationalReview['verdict'])
        : 'pending',
      createdAt: row.updatedAt.toISOString(),
      reviewer: 'Independent reviewer',
      feedback: 'Review decision is pending; no self-approval is available in this surface.',
    };
    const activity: OperationalActivity = {
      id: 'activity-fixture',
      projectId: row.id,
      kind: 'status',
      occurredAt: row.updatedAt.toISOString(),
      summary: 'Protected activity projection',
    };

    const workspace: OperationalWorkspaceReadModel = {
      schemaVersion: '1',
      readOnly: true,
      project: {
        authority: 'control-plane',
        items: [project],
        state: 'visible',
        source: 'themis-control-plane',
        observedAt,
      },
      protectedContext: collection('local-agent-mediated-read', observedAt, state, [], 'local-agent'),
      epics: collection('opaque-encrypted-source', observedAt, state, visibleItems ? [epic] : []),
      workItems: collection('opaque-encrypted-source', observedAt, state, visibleItems ? [workItem] : []),
      runs: collection('opaque-encrypted-source', observedAt, state, visibleItems ? [run] : []),
      evidence: collection('opaque-encrypted-source', observedAt, state, visibleItems ? [evidence] : []),
      reviews: collection('opaque-encrypted-source', observedAt, state, visibleItems ? [review] : []),
      activity: collection('opaque-encrypted-source', observedAt, state, visibleItems ? [activity] : []),
      iteration: collection('control-plane', observedAt, state, [], 'control-plane'),
    };

    if (state === 'malformed') {
      return {
        ...workspace,
        workItems: { ...workspace.workItems, items: [{ id: 'malformed-item' }] },
      } as unknown as OperationalWorkspaceReadModel;
    }

    return workspace;
  });
}

export { getOperationalWorkspace };
export type { OperationalWorkspaceContext };
