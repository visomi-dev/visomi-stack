import { defineRailway, github, project, service } from 'railway/iac';

export const watchPatterns = [
  '/apps/web/gateway/**',
  '/apps/web/api/**',
  '/apps/web/site/**',
  '/libs/backend/shared/**',
  '/libs/web/backend/shared/**',
  '/libs/web/frontend/ui/**',
  '/styles.base.css',
  '/theme.base.js',
  '/.postcssrc.json',
  '/package.json',
  '/pnpm-lock.yaml',
  '/pnpm-workspace.yaml',
  '/nx.json',
  '/tsconfig*.json',
  '/.node-version',
  '/Dockerfile',
  '/.dockerignore',
  '/patches/**',
  '/.railway/**',
];

export default defineRailway(() => {
  const gateway = service('web-gateway', {
    source: github('visomi-dev/visomi-stack', { branch: 'main', commitSha: null, checkSuites: true }),
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile', watchPatterns },
    deploy: {
      startCommand: 'node dist/apps/web/gateway/main.js',
      healthcheckPath: '/api/',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
      drainingSeconds: 10,
      sleepApplication: false,
    },
    env: {
      APP_NAME: 'web-gateway',
      HOST: '0.0.0.0',
      PORT: '8080',
      NODE_ENV: 'production',
      ASTRO_TELEMETRY_DISABLED: '1',
    },
  });

  return project('visomi-stack', { resources: [gateway] });
});
