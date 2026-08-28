import { publishJson, subscribeToJson } from 'shared';

import type { AsyncJobEvent, AsyncJobEventName, AsyncJobRecord } from '../contracts/async-jobs';

const projectAsyncJobEventsChannel = 'projects.async-job';

function createAsyncJobEvent(eventName: AsyncJobEventName, job: AsyncJobRecord, message: string): AsyncJobEvent {
  return {
    eventName,
    job,
    message,
    timestamp: new Date().toISOString(),
  };
}

async function publishProjectAsyncJobEvent(eventName: AsyncJobEventName, job: AsyncJobRecord, message: string) {
  await publishJson(projectAsyncJobEventsChannel, createAsyncJobEvent(eventName, job, message));
}

async function subscribeToProjectAsyncJobEvents(onMessage: (event: AsyncJobEvent) => void | Promise<void>) {
  await subscribeToJson<AsyncJobEvent>(projectAsyncJobEventsChannel, onMessage);
}

export { projectAsyncJobEventsChannel, publishProjectAsyncJobEvent, subscribeToProjectAsyncJobEvents };
