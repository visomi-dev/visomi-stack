import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Auth } from '../auth/auth';

const socketMocks = vi.hoisted(() => {
  const disconnectSocket = vi.fn();

  const on = vi.fn();
  const emit = vi.fn();

  const socketFactory = vi.fn(() => ({
    connected: true,
    disconnect: disconnectSocket,
    on,
    emit,
  }));

  return { disconnectSocket, on, emit, socketFactory };
});

vi.mock('socket.io-client', () => ({
  io: socketMocks.socketFactory,
}));

import { BrowserRealtime } from './browser-realtime';
import { Realtime } from './realtime';

describe('BrowserRealtime', () => {
  const $user = signal<{ accountId: string; email: string; emailVerifiedAt: string | null; id: string } | null>(null);

  beforeEach(() => {
    $user.set(null);
    socketMocks.socketFactory.mockClear();
    socketMocks.on.mockClear();
    socketMocks.disconnectSocket.mockClear();
    socketMocks.emit.mockClear();

    TestBed.configureTestingModule({
      providers: [
        BrowserRealtime,
        { provide: Realtime, useExisting: BrowserRealtime },
        {
          provide: Auth,
          useValue: {
            user: $user.asReadonly(),
          },
        },
      ],
    });
  });

  it('connects when an authenticated user is available', () => {
    TestBed.inject(Realtime);

    $user.set({
      accountId: 'account-1',
      email: 'engineer@themis.dev',
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      id: 'user-1',
    });
    TestBed.flushEffects();

    expect(socketMocks.socketFactory).toHaveBeenCalledWith('/', expect.objectContaining({ path: '/socket.io' }));
  });

  it('disconnects when the authenticated user becomes null', () => {
    TestBed.inject(Realtime);

    $user.set({
      accountId: 'account-1',
      email: 'engineer@themis.dev',
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      id: 'user-1',
    });
    TestBed.flushEffects();
    $user.set(null);
    TestBed.flushEffects();

    expect(socketMocks.disconnectSocket).toHaveBeenCalled();
  });

  it('replays operation watches on reconnect, rejects malformed events and clears callbacks on logout', async () => {
    const realtime = TestBed.inject(Realtime);

    $user.set({ accountId: 'account-1', email: 'engineer@themis.dev', emailVerifiedAt: null, id: 'user-1' });
    TestBed.flushEffects();
    const operationId = '22222222-2222-4222-8222-222222222222';
    const callback = vi.fn();

    realtime.watchOperation(operationId, callback);
    const connected = socketMocks.on.mock.calls.find(([name]) => name === 'connect')?.[1] as () => void;
    const changed = socketMocks.on.mock.calls.find(([name]) => name === 'operation:changed')?.[1] as (
      input: unknown,
    ) => void;

    connected();
    expect(socketMocks.emit).toHaveBeenCalledWith('operation:watch', { operationId });
    changed({ operationId, status: 'completed', result: { jobId: operationId, privateContent: 'reject' } });
    expect(callback).not.toHaveBeenCalled();
    changed({ operationId, status: 'pending' });
    await expect.poll(() => callback.mock.calls).toEqual([[{ operationId, status: 'pending' }]]);
    $user.set(null);
    TestBed.flushEffects();
    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed', error: { code: 'operation_cancelled', status: 409 } }),
    );
  });

  it('drops the previous account watches before establishing the next account socket', () => {
    const realtime = TestBed.inject(Realtime);

    $user.set({ accountId: 'account-1', email: 'engineer@themis.dev', emailVerifiedAt: null, id: 'user-1' });
    TestBed.flushEffects();
    const callback = vi.fn();

    realtime.watchOperation('22222222-2222-4222-8222-222222222222', callback);
    $user.set({ accountId: 'account-2', email: 'engineer@themis.dev', emailVerifiedAt: null, id: 'user-1' });
    TestBed.flushEffects();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 'operation_cancelled', status: 409 } }),
    );
    expect(socketMocks.socketFactory).toHaveBeenCalledTimes(2);
  });

  it('discards pending lazy validation after its watch is removed instead of delivering into a replacement watch', async () => {
    const realtime = TestBed.inject(Realtime);

    $user.set({ accountId: 'account-1', email: 'engineer@themis.dev', emailVerifiedAt: null, id: 'user-1' });
    TestBed.flushEffects();
    const operationId = '22222222-2222-4222-8222-222222222222';
    const first = vi.fn();
    const second = vi.fn();
    const stop = realtime.watchOperation(operationId, first);
    const changed = socketMocks.on.mock.calls.find(([name]) => name === 'operation:changed')?.[1] as (
      input: unknown,
    ) => void;

    changed({ operationId, status: 'pending' });
    stop();
    realtime.watchOperation(operationId, second);
    // A subsequent current event is the completion barrier for both lazy-validation promises.
    changed({ operationId, status: 'running' });
    await expect.poll(() => second.mock.calls).toEqual([[{ operationId, status: 'running' }]]);
    expect(first).not.toHaveBeenCalled();
  });

  it('keeps a freshly registered watch when the initial authenticated connection starts', () => {
    $user.set({ accountId: 'account-1', email: 'engineer@themis.dev', emailVerifiedAt: null, id: 'user-1' });
    const realtime = TestBed.inject(Realtime);
    const callback = vi.fn();
    const operationId = '22222222-2222-4222-8222-222222222222';

    realtime.watchOperation(operationId, callback);
    TestBed.flushEffects();
    const connected = socketMocks.on.mock.calls.find(([name]) => name === 'connect')?.[1] as () => void;

    connected();
    expect(socketMocks.emit).toHaveBeenCalledWith('operation:watch', { operationId });
    expect(callback).not.toHaveBeenCalled();
  });

  it('bounds notification watches, replays on reconnect and rejects payloads or departed callbacks', () => {
    const realtime = TestBed.inject(Realtime);

    $user.set({ accountId: 'account-1', email: 'engineer@example.test', emailVerifiedAt: null, id: 'user-1' });
    TestBed.flushEffects();
    const callback = vi.fn();
    const unwatch = realtime.watchNotifications(callback);
    const connected = socketMocks.on.mock.calls.find(([name]) => name === 'connect')?.[1] as () => void;
    const changed = socketMocks.on.mock.calls.find(([name]) => name === 'notifications:changed')?.[1] as (
      input: unknown,
    ) => void;

    connected();
    expect(socketMocks.emit).toHaveBeenCalledWith('notifications:watch');
    for (const payload of [null, [], { text: 'private' }, { accountId: 'other' }]) changed(payload);
    expect(callback).not.toHaveBeenCalled();
    changed({});
    expect(callback).toHaveBeenCalledTimes(1);
    unwatch();
    expect(socketMocks.emit).toHaveBeenCalledWith('notifications:unwatch');
    changed({});
    expect(callback).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 8; index += 1) realtime.watchNotifications(vi.fn());
    expect(() => realtime.watchNotifications(vi.fn())).toThrow('capacity exceeded');
    $user.set(null);
    TestBed.flushEffects();
    changed({});
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
