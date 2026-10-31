import { defineRailway, github, project, service } from 'railway/iac';

export default defineRailway(() => {
  const gateway = service('web-gateway', {
    source: github('visomi-dev/visomi-stack', { branch: 'main', checkSuites: true }),
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
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
