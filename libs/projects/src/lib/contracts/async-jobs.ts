type AsyncJobType = 'project_seed';
type AsyncJobStatus = 'completed' | 'failed' | 'queued' | 'running';

type AsyncJobEventName = 'job:completed' | 'job:failed' | 'job:progress' | 'job:queued' | 'job:started';

type AsyncJobRecord = {
  completedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  id: string;
  progress: number;
  projectId: string | null;
  resultJson: string | null;
  status: AsyncJobStatus;
  type: AsyncJobType;
  updatedAt: string;
  userId: string;
};

type AsyncJobEvent = {
  eventName: AsyncJobEventName;
  job: AsyncJobRecord;
  message: string;
  timestamp: string;
};

type JobsListResponse = {
  jobs: AsyncJobRecord[];
};

export type { AsyncJobEvent, AsyncJobEventName, AsyncJobRecord, AsyncJobStatus, AsyncJobType, JobsListResponse };
