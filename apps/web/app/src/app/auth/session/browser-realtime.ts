import { Service, signal } from '@angular/core';
import type { Socket } from 'socket.io-client';

import type { ApprovalEvent, SessionRealtime } from './realtime';

@Service({ autoProvided: false })
export class BrowserRealtime implements SessionRealtime {
  private readonly online = signal(false);

  readonly connected = this.online.asReadonly();

  private session: Socket | undefined;

  connectSession(refresh: () => void): () => void {
    const close = this.open('/session', (socket) => {
      this.session = socket;
      socket.on('connect', () => this.online.set(true));
      socket.on('disconnect', (reason) => {
        this.online.set(false);

        if (reason === 'io server disconnect') {
          refresh();
        }
      });
      socket.on('connect_error', () => this.online.set(false));
      socket.on('session:changed', refresh);
    });

    return () => {
      close();
      this.session = undefined;
      this.online.set(false);
    };
  }

  async checkSession(): Promise<boolean> {
    const socket = this.session;

    if (!socket?.connected) {
      return false;
    }

    try {
      const current: unknown = await socket.timeout(3000).emitWithAck('session:check');

      return this.session === socket && socket.connected && current === true;
    } catch {
      return false;
    }
  }

  watchDeviceApproval(requestId: string, notify: (event: ApprovalEvent) => void): () => void {
    return this.open(
      '/',
      (socket) => {
        socket.auth = { requestId };
        socket.on('connect', () => notify('connected'));
        socket.on('disconnect', () => notify('disconnected'));
        socket.on('connect_error', () => notify('disconnected'));
        socket.on('device-approval:changed', () => notify('changed'));
      },
      () => notify('disconnected'),
    );
  }

  private open(namespace: string, configure: (socket: Socket) => void, failed?: () => void): () => void {
    let stopped = false;
    let socket: Socket | undefined;

    void import('socket.io-client')
      .then(({ io }) => {
        if (stopped) {
          return;
        }

        socket = io(namespace, {
          autoConnect: false,
          forceNew: true,
          path: '/socket.io',
          transports: ['websocket'],
        });
        configure(socket);
        socket.connect();
      })
      .catch(() => {
        if (!stopped) {
          failed?.();
        }
      });

    return () => {
      stopped = true;
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }
}
