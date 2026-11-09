import { spawn, type ChildProcess } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { SMTPServer } from 'smtp-server';
import { testPostgres } from '@visomi-stack/dev-testing/postgres';

async function serve(): Promise<void> {
  const directory = process.env['VISOMI_E2E_TELEMETRY_DIR'];

  if (!directory) {
    throw new Error('isolated_auth_directory_required');
  }

  let postgres: Awaited<ReturnType<typeof testPostgres>> | undefined;
  let child: ChildProcess | undefined;
  let smtp: SMTPServer | undefined;
  let resolveStopped: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const stop = () => {
    child?.kill('SIGTERM');
    resolveStopped();
  };

  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  try {
    const result1 = await testPostgres(join(directory, 'postgres.json'), 'web-gateway');

    postgres = result1;

    await writeFile(join(directory, 'database.json'), JSON.stringify({ url: postgres.url }));

    smtp = new SMTPServer({
      logger: false,
      disabledCommands: ['AUTH', 'STARTTLS'],
      onData(stream, session, callback) {
        let raw = '';

        stream.on('data', (chunk) => {
          raw += String(chunk);
        });
        stream.on('end', () => {
          void appendFile(
            join(directory, 'mailbox.jsonl'),
            JSON.stringify({ to: session.envelope.rcptTo[0].address, raw }) + '\n',
          )
            .then(() => callback())
            .catch(() => callback(new Error('synthetic_mail_unavailable')));
        });
      },
    });

    await new Promise<void>((resolve) => smtp!.listen(0, '127.0.0.1', resolve));

    const smtpPort = ((smtp as unknown as { server: Server }).server.address() as { port: number }).port;

    child = spawn(process.execPath, ['dist/apps/web/gateway/main.js'], {
      cwd: workspaceRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '4204',
        DATABASE_URL: postgres.url,
        REALTIME_REDIS_URL: '',
        AUTH_ORIGIN: 'http://localhost:4204',
        AUTH_RP_ID: 'localhost',
        SESSION_SECRET: 'synthetic-auth-ui-session-secret-32-bytes',
        AUTH_TRUST_PROXY: '127.0.0.1',
        GOOGLE_AUTH_CLIENT_ID: '',
        AUTH_TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtpPort),
        SMTP_FROM: 'auth@example.test',
        SMTP_ALLOW_INSECURE_LOCAL: 'true',
        SMTP_SECURE: 'false',
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        VISOMI_BROWSER_TELEMETRY: 'false',
        API_APP_PATH: '',
        SITE_APP_PATH: '',
        APPLICATION_APP_PATH: '',
        OTEL_EXPORTER_OTLP_ENDPOINT: '',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',
        OTEL_EXPORTER_OTLP_HEADERS: '',
        VISOMI_OTLP_ENDPOINT: '',
        VISOMI_OTLP_TRACING: 'false',
      },
    });
    child.once('exit', () => resolveStopped());
    child.once('error', () => resolveStopped());

    await stopped;
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);

    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));

      child.kill('SIGTERM');

      await exited;
    }

    if (smtp) {
      await new Promise<void>((resolve) => smtp!.close(resolve));
    }

    await postgres?.stop();
  }
}
void serve().catch(() => {
  process.stderr.write('isolated_auth_ui_startup_failed\n');
  process.exitCode = 1;
});
