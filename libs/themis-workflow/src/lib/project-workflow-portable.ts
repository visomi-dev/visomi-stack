import type { WorkflowEvent } from './project-workflow-contract.ts';

export const redactPortable = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactPortable);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

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
