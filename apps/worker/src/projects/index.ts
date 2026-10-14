import { startProjectSeedWorker } from './project-seed/worker';

export function start() {
  const worker = startProjectSeedWorker();

  return worker;
}
