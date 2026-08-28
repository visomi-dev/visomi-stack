type ProjectSeedJobInput = {
  accountId: string;
  jobId: string;
  projectId: string;
  userId: string;
};

type ProjectSeedJobResult = {
  summary: string;
};

export type { ProjectSeedJobInput, ProjectSeedJobResult };
