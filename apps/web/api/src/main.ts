import { pathToFileURL } from 'node:url';

import { createApp } from './app';

const host = process.env.HOST ?? 'localhost';

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

function isMainModule() {
  const entryFile = process.argv[1];

  if (!entryFile) {
    return false;
  }

  return import.meta.url === pathToFileURL(entryFile).href;
}

const runningAsMainModule = isMainModule();

const appPromise = runningAsMainModule ? createApp() : undefined;

function createEmbeddedApp() {
  return createApp({ mountAuthRuntime: false });
}

if (runningAsMainModule && appPromise) {
  appPromise
    .then((app) => {
      app.listen(port, host, () => {
        console.log(`[ ready ] http://${host}:${port}`);
      });
    })
    .catch((error: unknown) => {
      console.error('[ error ] Failed to start API server', error);
      process.exit(1);
    });
}

export { appPromise, createEmbeddedApp };
