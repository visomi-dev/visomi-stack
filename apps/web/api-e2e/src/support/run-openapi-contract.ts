import { rm, mkdir, writeFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { gatewayStorageEnvironment } from './gateway-environment.ts';
import { requireFreeGatewayPort, waitForGateway } from './gateway-process.ts';
import {
  host,
  port,
  reportDirectory,
  stableReportDirectory,
  rawDirectory,
  clockFilePath,
  serverEntryPoint,
  baseUrl,
  phases,
  clockAdvanceFilePath,
  clockPreloadPath,
  pidPath,
  syncOnly,
  passkeyOnly,
  apiUrl,
  origin,
  generationMode,
  includePathRegex,
  rawHttpObservations,
  runId,
} from './openapi-contract-context.ts';
import { captureOutput, sanitizeText, sanitizeReports } from './report-sanitization.ts';
import { bootstrapSession, verifyFixtureBoundary } from './openapi-contract-fixture.ts';
import { verifySyncEvidence } from './openapi-contract-sync.ts';
import { verifyPasskeySmoke } from './openapi-contract-passkey.ts';
import { prepareSchema } from './openapi-contract-schema.ts';

let activeServerPid: number | undefined;

function stopServer(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== 'ESRCH') {
      console.error('Failed to stop the OpenAPI contract test server.', error);
    }
  }
}

async function run(): Promise<number> {
  const storageEnvironment = gatewayStorageEnvironment(process.env);

  await requireFreeGatewayPort(host, port);
  await rm(reportDirectory, { recursive: true, force: true });
  await rm(stableReportDirectory, { recursive: true, force: true });
  if (process.env['PZS005_ARTIFACT_DIR']) {
    await rm(resolve(process.env['PZS005_ARTIFACT_DIR']), { recursive: true, force: true });
    await mkdir(resolve(process.env['PZS005_ARTIFACT_DIR']), { recursive: true });
  }
  await mkdir(reportDirectory, { recursive: true });
  await mkdir(rawDirectory, { recursive: true });
  await writeFile(clockFilePath, String(Date.now()));
  const consoleOutput = { value: '' };
  const rawConsoleOutput = { value: '' };

  const server = spawn(process.execPath, [serverEntryPoint], {
    detached: true,
    env: {
      ...process.env,
      BASE_URL: baseUrl,
      COOKIE_SECURE: 'false',
      DATABASE_AUTO_MIGRATE: 'true',
      ...storageEnvironment,
      ENABLE_TEST_API: 'true',
      ENABLE_LOCAL_ACTIVATION: 'false',
      HOST: host,
      GATEWAY_PORT: String(port),
      MAIL_TRANSPORT: 'memory',
      NG_ALLOWED_HOSTS: host,
      NODE_ENV: 'test',
      PIN_RESEND_COOLDOWN_SECONDS: phases.includes('fuzzing') ? '0' : process.env['PIN_RESEND_COOLDOWN_SECONDS'],
      PORT: String(port),
      SESSION_SECRET: 'themis-api-openapi-e2e-secret',
      WEBAUTHN_ORIGIN: baseUrl,
      WEBAUTHN_RP_ID: host,
      PASSKEY_E2E_CLOCK_FILE: clockFilePath,
      PASSKEY_E2E_CLOCK_ADVANCE_FILE: clockAdvanceFilePath,
      PASSKEY_E2E_CLOCK_STEP_MS: '2000',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${clockPreloadPath}`.trim(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (server.stdout) {
    captureOutput(server.stdout, consoleOutput, rawConsoleOutput);
  }
  if (server.stderr) {
    captureOutput(server.stderr, consoleOutput, rawConsoleOutput);
  }

  if (server.pid == null) {
    throw new Error('Failed to start composition server for OpenAPI contract tests.');
  }

  activeServerPid = server.pid;
  await writeFile(pidPath, String(server.pid));

  try {
    await waitForGateway(server, `${baseUrl}/healthz`);
    await waitForHealth(baseUrl);
    const fixture = await bootstrapSession();

    if (!syncOnly && !passkeyOnly) {
      await verifyFixtureBoundary(fixture);
    }
    if (!passkeyOnly) {
      await verifySyncEvidence(fixture);
    }
    if (!syncOnly) {
      await verifyPasskeySmoke(fixture);
    }
    const fixtureSchema = await prepareSchema(fixture);

    const result = await new Promise<number>((resolveResult, reject) => {
      const contract = spawn(
        'uvx',
        [
          '--from',
          'schemathesis==4.24.3',
          '--with',
          'jsonschema-rs==0.49.1',
          'schemathesis',
          'run',
          fixtureSchema,
          '--url',
          apiUrl,
          '--header',
          `Cookie: ${passkeyOnly ? fixture.schemaExampleCookie : fixture.cookie}`,
          '--header',
          `Origin: ${origin}`,
          '--exclude-path-regex',
          '^/test/',
          '--phases',
          phases,
          '--workers',
          '1',
          '--mode',
          generationMode,
          ...(generationMode === 'negative' ? ['--exclude-checks', 'positive_data_acceptance'] : []),
          '--generation-deterministic',
          '--seed',
          '20260818',
          '--max-examples',
          '5',
          '--max-failures',
          '20',
          '--request-timeout',
          '5',
          '--max-response-time',
          '5',
          '--continue-on-failure',
          '--report',
          'junit,har',
          '--report-dir',
          reportDirectory,
          '--output-sanitize',
          'true',
          '--wait-for-schema',
          '30',
          ...(includePathRegex ? ['--include-path-regex', includePathRegex] : []),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      if (contract.stdout) {
        captureOutput(contract.stdout, consoleOutput);
      }
      if (contract.stderr) {
        captureOutput(contract.stderr, consoleOutput);
      }

      contract.once('error', reject);

      contract.once('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`Schemathesis exited due to signal ${signal}.`));

          return;
        }

        resolveResult(code ?? 1);
      });
    });

    return result;
  } finally {
    stopServer(server.pid);
    activeServerPid = undefined;
    await writeFile(resolve(rawDirectory, 'server.log'), rawConsoleOutput.value);
    await writeFile(resolve(rawDirectory, 'http-responses.json'), JSON.stringify(rawHttpObservations, null, 2));
    const artifactRawDirectory = process.env['PZS005_ARTIFACT_DIR']
      ? resolve(process.env['PZS005_ARTIFACT_DIR'], 'openapi-report/raw')
      : rawDirectory;

    if (artifactRawDirectory !== rawDirectory) {
      await rm(resolve(process.env['PZS005_ARTIFACT_DIR']!, 'openapi-report'), { recursive: true, force: true });
      await mkdir(artifactRawDirectory, { recursive: true });
      await cp(rawDirectory, artifactRawDirectory, { recursive: true });
    }
    const rawScanDirectory = artifactRawDirectory;
    const rawScan = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/operational-workspace-security-scan.ts', rawScanDirectory],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    await writeFile(
      resolve(reportDirectory, 'raw-scan-result.json'),
      JSON.stringify(
        {
          command: `node --experimental-strip-types scripts/operational-workspace-security-scan.ts ${rawScanDirectory}`,
          status: rawScan.status,
          stdout: rawScan.stdout,
          stderr: rawScan.stderr,
        },
        null,
        2,
      ),
    );
    if (rawScan.status !== 0) {
      console.error(`Raw operational workspace security scan failed: ${rawScan.stderr}`);
      process.exitCode = 1;
    }
    await writeFile(resolve(reportDirectory, 'console.log'), consoleOutput.value);
    const warningLines = consoleOutput.value
      .split('\n')
      .map((line) => sanitizeText(line))
      .filter((line) => /Authentication failed:|Schema validation mismatch:/i.test(line));

    await writeFile(
      resolve(reportDirectory, 'openapi-warning-disposition.json'),
      JSON.stringify(
        {
          runId,
          scope: includePathRegex ?? 'all OpenAPI paths',
          warnings: warningLines.map((line) => ({
            observed: line,
            disposition: /authentication/i.test(line) ? 'blocked-authentication-warning' : 'blocked-schema-warning',
            reason:
              "The warning is current-run OpenAPI output for this run and scope; the warning is not converted into a pass. Authenticated transport evidence is retained only in this run's artifacts.",
          })),
        },
        null,
        2,
      ),
    );
    await sanitizeReports(reportDirectory);
    await cp(reportDirectory, stableReportDirectory, { recursive: true });
    if (process.env['PZS005_ARTIFACT_DIR']) {
      const artifactReportDirectory = resolve(process.env['PZS005_ARTIFACT_DIR'], 'openapi-report');

      await rm(artifactReportDirectory, { recursive: true, force: true });
      await cp(reportDirectory, artifactReportDirectory, { recursive: true });
    }
    await rm(pidPath, { force: true });
    await rm(clockFilePath, { force: true });
  }
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1000) });

      if (response.ok) {
        return;
      }
    } catch {
      // A listener can accept TCP before the gateway is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Gateway health check did not become ready at ${baseUrl}/healthz.`);
}

async function handleSignal(code: number): Promise<void> {
  if (activeServerPid !== undefined) {
    stopServer(activeServerPid);
  }
  await rm(pidPath, { force: true });
  process.exit(code);
}

process.once('SIGINT', () => void handleSignal(130));

process.once('SIGTERM', () => void handleSignal(143));

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(sanitizeText(String(error)));
    process.exitCode = 1;
  });
