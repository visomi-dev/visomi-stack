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
    // Native edge tracing retains raw paths and client trace IDs independently of the application.
    tracing: { enabled: false, autoInstrumentation: false },
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
      VISOMI_RAILWAY_TRACING: 'false',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_LOGS_EXPORTER: 'none',
    },
  });

  return project('visomi-stack', { resources: [gateway] });
});
