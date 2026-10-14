import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { extractorManifest, runExtractor } from './extractor';

jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  execFile: jest.fn(),
  spawn: jest.fn(),
}));

type EngineExec = (
  engine: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;
const execMock = execFile as unknown as jest.MockedFunction<EngineExec>;
const manifest = {
  version: 1,
  id: 'selected-document',
  image: `sha256:${'a'.repeat(64)}`,
  network: 'none',
  secrets: [],
};
const parseResult = (value: unknown) => {
  if (!value || typeof value !== 'object' || !('accepted' in value) || value.accepted !== true) {
    throw new Error('private-result-validation-detail');
  }

  return { accepted: true };
};

function childFixture() {
  const child = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const kill = jest.fn(() => {
    queueMicrotask(() => child.emit('close', null));

    return true;
  });

  jest.mocked(spawn).mockImplementation(() => {
    markStarted();

    return Object.assign(child, { stdin, stdout, stderr, kill }) as unknown as ChildProcessWithoutNullStreams;
  });

  return { child, stdin, stdout, stderr, kill, started };
}

describe('operator-selected extractor isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    execMock.mockImplementation((_engine, _args, _options, callback) => callback(null, 'fixture-engine', ''));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    { ...manifest, image: 'untrusted:latest' },
    { ...manifest, image: '--privileged' },
    { ...manifest, network: 'host' },
    { ...manifest, secrets: ['ambient'] },
    { ...manifest, mounts: ['/'] },
  ])('rejects unpinned images and ambient-authority requests before invoking an engine', async (input) => {
    expect(extractorManifest.safeParse(input).success).toBe(false);
    await expect(runExtractor(input, new Uint8Array([1]), { engine: 'podman', parseResult })).rejects.toThrow(
      'plugin_manifest_invalid',
    );
    expect(execMock).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([new Uint8Array(), new Uint8Array(1_048_577)])(
    'rejects empty and oversized documents before invoking an engine',
    async (bytes) => {
      await expect(runExtractor(manifest, bytes, { engine: 'podman', parseResult })).rejects.toThrow(
        'plugin_input_limit',
      );
      expect(execMock).not.toHaveBeenCalled();
    },
  );

  it('passes only the selected document and restrictive literal engine arguments, then removes only its container', async () => {
    const fixture = childFixture();
    const bytes = new Uint8Array([1, 2, 3]);
    const result = runExtractor(manifest, bytes, { engine: 'podman', parseResult });

    await fixture.started;
    const [selectedEngine, args, options] = jest.mocked(spawn).mock.calls[0];

    expect(selectedEngine).toBe('podman');
    expect(args).toEqual([
      '--remote=false',
      'run',
      '--pull=never',
      '--name',
      expect.stringMatching(/^visomi-extractor-/),
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=64',
      '--memory=256m',
      '--cpus=1',
      '--user=65534:65534',
      '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
      '-i',
      manifest.image,
    ]);
    expect(options).toEqual({ stdio: ['pipe', 'pipe', 'pipe'] });
    expect(JSON.parse(fixture.stdin.read().toString())).toEqual({ version: 1, document: 'AQID' });
    fixture.stdout.emit('data', Buffer.from('{"accepted":true}'));
    fixture.child.emit('close', 0);
    await expect(result).resolves.toEqual({ accepted: true });
    expect(execMock).toHaveBeenLastCalledWith(
      'podman',
      ['--remote=false', 'rm', '-f', '--time=0', '--ignore', args?.[4]],
      { timeout: 10_000, maxBuffer: 4096 },
      expect.any(Function),
    );
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each(['stdout', 'stderr'] as const)('kills and cleans up an extractor exceeding its %s budget', async (stream) => {
    const fixture = childFixture();
    const result = runExtractor(manifest, new Uint8Array([1]), { engine: 'docker', parseResult });
    const rejection = expect(result).rejects.toThrow('plugin_output_limit');

    await fixture.started;
    fixture[stream].emit('data', Buffer.alloc(64_001));
    await rejection;
    expect(fixture.kill).toHaveBeenCalledWith('SIGKILL');
    expect(execMock.mock.calls.slice(-1)[0]?.[1].slice(1, 3)).toEqual(['rm', '-f']);
  });

  it('kills timed-out work and awaits owned cleanup', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    const fixture = childFixture();
    const result = runExtractor(manifest, new Uint8Array([1]), { engine: 'podman', parseResult });
    const rejection = expect(result).rejects.toThrow('plugin_timeout');

    await jest.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(fixture.kill).toHaveBeenCalledWith('SIGKILL');
    expect(execMock.mock.calls.slice(-1)[0]?.[1].slice(1, 3)).toEqual(['rm', '-f']);
  });

  it('forces the approved Docker Unix socket instead of ambient remote-daemon settings', async () => {
    const fixture = childFixture();
    const result = runExtractor(manifest, new Uint8Array([1]), {
      engine: 'docker',
      dockerSocket: '/run/user/1000/docker.sock',
      parseResult,
    });

    await fixture.started;
    expect(jest.mocked(spawn).mock.calls[0][1]?.[0]).toBe('--host=unix:///run/user/1000/docker.sock');
    fixture.stdout.emit('data', Buffer.from('{"accepted":true}'));
    fixture.child.emit('close', 0);
    await expect(result).resolves.toEqual({ accepted: true });
  });

  it('rejects remote socket strings and pre-cancelled invocations before probing an engine', async () => {
    await expect(
      runExtractor(manifest, new Uint8Array([1]), {
        engine: 'docker',
        dockerSocket: 'tcp://untrusted:2375',
        parseResult,
      }),
    ).rejects.toThrow('plugin_manifest_invalid');
    const controller = new AbortController();

    controller.abort();
    await expect(
      runExtractor(manifest, new Uint8Array([1]), {
        engine: 'podman',
        signal: controller.signal,
        parseResult,
      }),
    ).rejects.toThrow('plugin_cancelled');
    expect(execMock).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('cancels owned work without passing the signal or host credentials into the container', async () => {
    const fixture = childFixture();
    const controller = new AbortController();
    const result = runExtractor(manifest, new Uint8Array([1]), {
      engine: 'podman',
      parseResult,
      signal: controller.signal,
    });
    const rejection = expect(result).rejects.toThrow('plugin_cancelled');

    await fixture.started;
    controller.abort();
    await rejection;
    expect(fixture.kill).toHaveBeenCalledWith('SIGKILL');
    expect(execMock.mock.calls.slice(-1)[0]?.[1].slice(1, 3)).toEqual(['rm', '-f']);
  });

  it.each(['not-json', '{"private":"result"}', '\ufffd'])(
    'rejects malformed or unvalidated output without disclosing its contents',
    async (output) => {
      const fixture = childFixture();
      const result = runExtractor(manifest, new Uint8Array([1]), { engine: 'podman', parseResult });
      const rejection = expect(result).rejects.toThrow('plugin_invalid_output');

      await fixture.started;
      fixture.stdout.emit('data', Buffer.from(output));
      fixture.child.emit('close', 0);
      await rejection;
    },
  );

  it('does not conceal cleanup failure after an otherwise valid extraction', async () => {
    execMock.mockImplementation((_engine, args, _options, callback) =>
      callback(args.includes('rm') ? new Error('private-engine-error') : null, '', ''),
    );
    const fixture = childFixture();
    const result = runExtractor(manifest, new Uint8Array([1]), { engine: 'podman', parseResult });
    const rejection = expect(result).rejects.toThrow('plugin_cleanup_failed');

    await fixture.started;
    fixture.stdout.emit('data', Buffer.from('{"accepted":true}'));
    fixture.child.emit('close', 0);
    await rejection;
  });

  it('fails closed when the selected local engine cannot be probed', async () => {
    execMock.mockImplementation((_engine, _args, _options, callback) =>
      callback(new Error('private-engine-error'), '', 'private-engine-detail'),
    );

    await expect(runExtractor(manifest, new Uint8Array([1]), { engine: 'podman', parseResult })).rejects.toThrow(
      'plugin_unavailable',
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsupported engine before probing or sending bytes', async () => {
    const options = { engine: 'remote', parseResult } as unknown as Parameters<typeof runExtractor>[2];

    await expect(runExtractor(manifest, new Uint8Array([1]), options)).rejects.toThrow('plugin_manifest_invalid');
    expect(execMock).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('cleans up a failed spawn without leaking engine details', async () => {
    const fixture = childFixture();
    const result = runExtractor(manifest, new Uint8Array([1]), { engine: 'podman', parseResult });
    const rejection = expect(result).rejects.toThrow('plugin_unavailable');

    await fixture.started;
    fixture.child.emit('error', new Error('private-engine-detail'));
    fixture.child.emit('close', null);
    await rejection;
    expect(execMock.mock.calls.slice(-1)[0]?.[1].slice(1, 3)).toEqual(['rm', '-f']);
  });

  it.each([Buffer.from([0xc3, 0x28]), Buffer.from('{"accepted":true}')])(
    'rejects invalid UTF-8 or unsuccessful exit without changing the source buffer',
    async (output) => {
      const fixture = childFixture();
      const result = runExtractor(manifest, new Uint8Array([1]), { engine: 'podman', parseResult });
      const code = output[0] === 0xc3 ? 0 : 1;
      const rejection = expect(result).rejects.toThrow(code === 0 ? 'plugin_invalid_output' : 'plugin_failed');

      await fixture.started;
      fixture.stdout.emit('data', output);
      fixture.child.emit('close', code);
      await rejection;
      expect(output.some((byte) => byte !== 0)).toBe(true);
      expect(execMock.mock.calls.slice(-1)[0]?.[1].slice(1, 3)).toEqual(['rm', '-f']);
    },
  );
});
