import { boolean, string } from '@drizzle-team/brocli';

import { ProjectWorkflowStore, WorkspaceRegistry, redactPortable } from '../libs/themis-workflow/src/index.ts';

export const split = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const print = (value: unknown, asJson: boolean): void => {
  const portable = redactPortable(value);

  if (asJson) {
    console.log(JSON.stringify(portable, null, 2));

    return;
  }
  console.log(typeof portable === 'string' ? portable : JSON.stringify(portable, null, 2));
};

export const projectDomain = (root: string, projectId: string): ReturnType<ProjectWorkflowStore['domain']> =>
  new ProjectWorkflowStore(new WorkspaceRegistry(root), projectId).domain();

export const registeredProject = (root: string, projectId: string): void => {
  new WorkspaceRegistry(root).resolve(projectId);
};

export const registerProject = (root: string, projectId: string, name: string, summary: string) => {
  const registry = new WorkspaceRegistry(root);

  registry.register(projectId, name, root);

  return new ProjectWorkflowStore(registry, projectId)
    .domain()
    .createProject({ id: projectId, name, summary }, 'human:cli');
};

export const baseOptions = () => ({
  root: string().desc('Project root containing .themis').default('.'),
  json: boolean().desc('Print machine-readable JSON').default(false),
});
