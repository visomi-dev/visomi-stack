import { readFileSync } from 'node:fs';

import { database, defineRailway, github, image, postgres, preserve, project, service, volume } from 'railway/iac';

export const jaegerImage =
  'jaegertracing/jaeger:2.22.0@sha256:4d9387a02389204ef9a256cf291a36cfbae91983010e403b4d300202d07eff2a';
export const jaegerConfig = readFileSync(new URL('./jaeger.yaml', import.meta.url), 'utf8');

export const watchPatterns = [
  '/apps/web/gateway/**',
  '/apps/web/realtime/**',
  '/apps/web/api/**',
  '/apps/web/site/**',
  '/apps/web/app/**',
  '/assets/brand/**',
  '/tools/branding/**',
  '/libs/backend/shared/**',
  '/libs/web/backend/shared/**',
  '/libs/web/frontend/ui/**',
  '/libs/web/shared/observability/**',
  '/styles.base.css',
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
  const brokerData = volume('redis-volume', { sizeMB: 50000, region: 'us-east4-eqdc4a' });
  const broker = database('Redis', 'redis', {
    image: 'redis:8.2',
    output: 'REDIS_URL',
    defaultMountPath: '/data',
    region: 'us-east4-eqdc4a',
  });

  broker.tracing = { enabled: false, autoInstrumentation: false };
  broker.volumeAttachments = {
    'redis-volume': { volume: brokerData.address, mountPath: '/data', volumeConfig: brokerData.config },
  };
  const databaseVolume = volume('postgres-volume', { sizeMB: 50000, region: 'us-east4-eqdc4a' });
  const appDatabase = postgres('Postgres', { region: 'us-east4-eqdc4a' });

  appDatabase.tracing = { enabled: false, autoInstrumentation: false };
  appDatabase.volumeAttachments = {
    'postgres-volume': {
      volume: databaseVolume.address,
      mountPath: '/var/lib/postgresql/data',
      volumeConfig: databaseVolume.config,
    },
  };
  const traces = volume('jaeger-data', { sizeMB: 1024, region: 'us-east4-eqdc4a' });
  const jaeger = service('jaeger', {
    source: image(jaegerImage),
    tracing: { enabled: false, autoInstrumentation: false },
    replicas: { 'us-east4-eqdc4a': 1 },
    volumeMounts: { '/badger': traces },
    deploy: {
      startCommand: '/cmd/jaeger/jaeger-linux --config env:JAEGER_CONFIG',
      limitOverride: { containers: { cpu: 0.5, memoryBytes: 500000000 } },
      healthcheckPath: '/status',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
      drainingSeconds: 10,
      sleepApplication: false,
    },
    env: {
      PORT: '13133',
      // Railway volumes are root-owned; this private storage process owns its mounted data.
      RAILWAY_RUN_UID: '0',
      JAEGER_CONFIG: jaegerConfig,
      JAEGER_HTPASSWD: preserve(),
      OTLP_AUTH_HEADER: preserve(),
    },
  });
  const gateway = service('web-gateway', {
    source: github('visomi-dev/visomi-stack', { branch: 'main', commitSha: null, checkSuites: true }),
    root: '/',
    // Native edge tracing retains raw paths and client trace IDs independently of the application.
    tracing: { enabled: false, autoInstrumentation: false },
    domains: [{ domain: 'stack.visomi.dev', port: 8080 }],
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile', watchPatterns },
    deploy: {
      startCommand: 'node dist/apps/web/gateway/main.js',
      preDeployCommand: ['node libs/backend/shared/tools/database/migrate.mjs'],
      preDeployTimeoutSeconds: 120,
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
      DATABASE_URL: appDatabase.env.DATABASE_URL,
      AUTH_ORIGIN: 'https://stack.visomi.dev',
      AUTH_RP_ID: 'stack.visomi.dev',
      SESSION_SECRET: preserve(),
      GOOGLE_AUTH_CLIENT_ID: preserve(),
      // Restrict forwarded-header trust to verified ingress; revalidate after networking changes.
      AUTH_TRUST_PROXY: '100.64.0.0/10',
      REALTIME_REDIS_URL: broker.env.REDIS_URL,
      SMTP_HOST: preserve(),
      SMTP_PORT: preserve(),
      SMTP_SECURE: preserve(),
      SMTP_FROM: preserve(),
      SMTP_USER: preserve(),
      SMTP_PASSWORD: preserve(),
      ASTRO_TELEMETRY_DISABLED: '1',
      VISOMI_OTLP_TRACING: 'true',
      VISOMI_RAILWAY_TRACING: preserve(),
      VISOMI_BROWSER_TELEMETRY: 'true',
      VISOMI_BROWSER_PERFORMANCE: 'true',
      BROWSER_TELEMETRY_ORIGIN: 'https://stack.visomi.dev',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://${{jaeger.RAILWAY_PRIVATE_DOMAIN}}:4318',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_HEADERS: jaeger.env.OTLP_AUTH_HEADER,
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_LOGS_EXPORTER: 'none',
    },
  });

  return project('visomi-stack', {
    resources: [gateway, jaeger, broker, brokerData, appDatabase, databaseVolume],
  });
});
