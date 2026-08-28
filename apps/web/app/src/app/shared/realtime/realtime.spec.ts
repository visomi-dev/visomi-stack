import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Auth } from '../auth/auth';

const socketMocks = vi.hoisted(() => {
  const disconnectSocket = vi.fn();

  const on = vi.fn();

  const socketFactory = vi.fn(() => ({
    connected: true,
    disconnect: disconnectSocket,
    on,
  }));

  return { disconnectSocket, on, socketFactory };
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
});
