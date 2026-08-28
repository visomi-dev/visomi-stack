import { appendFileSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createPrivateKey, sign } from 'node:crypto';

export type LocalAgentFixtureState = 'available' | 'unavailable' | 'disconnected' | 'incompatible' | 'unsafe';
export type SyncFixturePhase = 'offline' | 'conflict' | 'reconnected' | 'deleted' | 'resolved';

const privateKey = createPrivateKey(`-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIG8V2hvowivr3fEdt8cIyeHi3k+VMLw07JZtSvmrMN2Y
-----END PRIVATE KEY-----`);

const projection = {
  tenantId: 'tenant-fixture',
  workspaceId: 'workspace-fixture',
  revision: 4,
  updatedAt: '2026-02-01T00:00:00.000Z',
  tombstones: [],
  work: [{ id: 'work-1', title: 'Review local projection', status: 'doing', position: 1 }],
  planning: [{ id: 'plan-1', title: 'Prepare release', horizon: 'next' }],
  progress: [{ id: 'progress-1', label: 'Implementation', percent: 60, updatedAt: '2026-02-01T00:00:00.000Z' }],
};

const syncProjection = {
  ...projection,
  revision: 7,
  work: [{ id: 'work-1', title: 'Resolved local change', status: 'done', position: 1 }],
  planning: [{ id: 'plan-1', title: 'Reconnect workspace', horizon: 'now' }],
  progress: [{ id: 'progress-1', label: 'Sync complete', percent: 100, updatedAt: '2026-02-08T00:00:00.000Z' }],
};

const syncProjections: Record<Exclude<SyncFixturePhase, 'offline'>, typeof syncProjection> = {
  conflict: { ...syncProjection, revision: -1, tombstones: ['work-1'], work: [], planning: [], progress: [] },
  reconnected: { ...syncProjection, revision: 7 },
  deleted: { ...syncProjection, revision: 7, tombstones: ['work-1'], work: [] },
  resolved: syncProjection,
};

let networkState: Exclude<LocalAgentFixtureState, 'incompatible' | 'unsafe'> = 'available';
let syncPhase: SyncFixturePhase = 'resolved';

function responseHeader(challengeHeader: string): string {
  const challenge = JSON.parse(Buffer.from(challengeHeader, 'base64url').toString('utf8')) as {
    nonce: string;
    origin: string;
    sessionId: string;
  };
  const unsigned = {
    deviceId: 'deterministic-e2e-device',
    nonce: challenge.nonce,
    origin: challenge.origin,
    sessionId: challenge.sessionId,
  };
  const signature = sign(null, Buffer.from(JSON.stringify(unsigned), 'utf8'), privateKey).toString('base64url');

  return Buffer.from(JSON.stringify({ ...unsigned, signature }), 'utf8').toString('base64url');
}

function projectId(request: IncomingMessage): string {
  return new URL(request.url ?? '/', 'http://localhost').pathname.split('/').pop() ?? '';
}

export type LocalAgentFixtureOptions = Readonly<{
  port?: number;
  logPath?: string;
  dynamicScope?: boolean;
  themisStatePath?: string;
}>;

type ThemisState = Readonly<{
  projects: readonly Readonly<{ id: string; name: string; status: string }>[];
  epics: readonly Readonly<{ id: string; title: string; status: string }>[];
  workItems: readonly Readonly<{ id: string; title: string; status: string }>[];
}>;

function readThemisProjection(statePath: string, workspaceId: string): typeof projection {
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as ThemisState;
  const work = state.workItems.slice(0, 8).map((item, index) => ({
    id: item.id,
    title: item.title,
    status:
      item.status === 'done' ? 'done' : item.status === 'in_progress' || item.status === 'claimed' ? 'doing' : 'todo',
    position: index + 1,
  }));
  const planning = state.epics.slice(0, 8).map((item) => ({
    id: item.id,
    title: item.title,
    horizon: item.status === 'in_progress' ? 'now' : item.status === 'planned' ? 'next' : 'later',
  }));
  const completed = state.workItems.filter((item) => item.status === 'done').length;

  return {
    tenantId: '',
    workspaceId,
    revision: state.workItems.length + state.epics.length,
    updatedAt: new Date().toISOString(),
    tombstones: [],
    work,
    planning,
    progress: [
      {
        id: 'themis-progress',
        label: state.projects[0]?.name ?? 'Themis state',
        percent: state.workItems.length === 0 ? 0 : Math.round((completed / state.workItems.length) * 100),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

function handle(request: IncomingMessage, response: ServerResponse, options: LocalAgentFixtureOptions = {}): void {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const record = (event: string, details: Record<string, unknown> = {}): void => {
    if (options.logPath)
      appendFileSync(options.logPath, `${JSON.stringify({ event, method: request.method, path, ...details })}\n`);
  };

  record('bridge.request', {
    capabilities: request.headers['x-themis-bridge-capabilities'] ?? null,
    version: request.headers['x-themis-bridge-version'] ?? null,
    handshake: typeof request.headers['x-themis-handshake-challenge'] === 'string',
  });

  if (request.url === '/__fixture__/ready') {
    record('bridge.ready');
    response.writeHead(200).end('ready');

    return;
  }

  if (request.url === '/__fixture__/network') {
    let body = '';

    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      const requested = JSON.parse(body) as { state: typeof networkState };

      networkState = requested.state;
      record('fixture.network', { state: requested.state });
      response.writeHead(204).end();
    });

    return;
  }

  if (request.url === '/__fixture__/sync-phase') {
    let body = '';

    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      syncPhase = (JSON.parse(body) as { phase: SyncFixturePhase }).phase;
      record('fixture.phase', { phase: syncPhase });
      response.writeHead(204).end();
    });

    return;
  }

  const state = networkState === 'available' ? (projectId(request) as LocalAgentFixtureState) : networkState;
  const isVisibilityProject = request.url?.startsWith('/projects/') ?? false;

  if (!isVisibilityProject && state === 'disconnected' && syncPhase !== 'conflict') {
    response.socket?.destroy();

    return;
  }

  if (!isVisibilityProject && state === 'unavailable') {
    response.writeHead(503).end('deterministic unavailable fixture');

    return;
  }

  const challenge = request.headers['x-themis-handshake-challenge'];

  if (typeof challenge !== 'string') {
    record('bridge.rejected', { reason: 'missing-challenge' });
    response.writeHead(400).end('missing bridge challenge');

    return;
  }

  response.setHeader('x-themis-handshake-response', responseHeader(challenge));
  response.setHeader('content-type', 'application/json');

  if (state === 'incompatible') {
    record('bridge.welcome', { state: 'incompatible', capabilities: [] });
    response.end(JSON.stringify({ format: 'unsupported.bridge', version: 99 }));

    return;
  }

  if (state === 'unsafe') {
    record('bridge.welcome', { state: 'unsafe', capabilities: ['projection'] });
    response.end(JSON.stringify({ projection, padding: 'unsafe-fixture-'.repeat(5000) }));

    return;
  }

  const selectedProjection = syncPhase === 'offline' ? syncProjection : syncProjections[syncPhase];
  const stateProjection = options.themisStatePath
    ? readThemisProjection(options.themisStatePath, projectId(request))
    : selectedProjection;
  const scopedProjection = options.themisStatePath
    ? stateProjection
    : options.dynamicScope
      ? { ...selectedProjection, tenantId: '', workspaceId: projectId(request) }
      : selectedProjection;

  record('bridge.welcome', { state: 'ready', capabilities: ['projection'], phase: syncPhase });

  if (request.url?.startsWith('/projects/')) {
    response.end(
      JSON.stringify({
        activity: [],
        context: null,
        project: {
          id: projectId(request),
          name: 'Sync route fixture',
          sourceType: 'manual',
          status: 'active',
          updatedAt: '2026-02-08T00:00:00.000Z',
        },
        state: 'authorized',
      }),
    );

    return;
  }

  response.end(
    JSON.stringify(
      request.headers['x-themis-projection-format'] === 'browser' ? scopedProjection : { projection: scopedProjection },
    ),
  );
}

export async function startLocalAgentFixture(options: LocalAgentFixtureOptions = {}): Promise<Server> {
  const server = createServer((request, response) => handle(request, response, options));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4317, '127.0.0.1', () => resolve());
  });

  return server;
}

export async function stopLocalAgentFixture(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

export async function setLocalAgentFixtureNetwork(
  state: Exclude<LocalAgentFixtureState, 'incompatible' | 'unsafe'>,
): Promise<void> {
  await fetch(`${process.env['LOCAL_AGENT_URL'] ?? 'http://127.0.0.1:4317'}/__fixture__/network`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state }),
  });
}

export async function setLocalAgentFixturePhase(phase: SyncFixturePhase): Promise<void> {
  await fetch(`${process.env['LOCAL_AGENT_URL'] ?? 'http://127.0.0.1:4317'}/__fixture__/sync-phase`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phase }),
  });
}

export const LOCAL_AGENT_FIXTURE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMiNlot5qU1DkSBrhasHJyQEDLwcpFWHVVYaEzOPz56w=
-----END PUBLIC KEY-----`;
