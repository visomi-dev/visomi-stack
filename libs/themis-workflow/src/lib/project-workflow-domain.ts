import type {
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
  listWorkItems,
  portfolio,
  proposeSprint,
  readyQueue,
  removeSprints,
  requestReview,
  startRun,
  submitReview,
  transitionWorkItem,
  updateWorkItem,
  validateState,
  Epic,
  Project,
  Sprint,
  ThemisState,
  TimelineEntry,
  WorkspaceStatus,
  WorkItem,
} from './legacy-workflow-internal.ts';

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
