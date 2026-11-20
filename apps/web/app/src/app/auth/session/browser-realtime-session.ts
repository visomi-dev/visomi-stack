import { Service, signal } from '@angular/core';
import type { Socket } from 'socket.io-client';

type ApprovalEvent = 'connected' | 'disconnected' | 'changed';

@Service({ autoProvided: false })
export class BrowserRealtimeSession {
  private readonly online = signal(false);

  private session: Socket | undefined;

  readonly connected = this.online.asReadonly();

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

  watchVault(authorize: () => Promise<unknown>, notify: (cursor: number) => void): () => void {
    return this.open('/vault', (socket) => {
      socket.auth = (reply) => {
        void authorize().then(
          (proof) => reply({ proof }),
          () => reply({}),
        );
      };

      socket.on('connect', () => notify(0));
      socket.on('disconnect', (reason) => {
        if (reason === 'io server disconnect') {
          socket.connect();
        }
      });

      socket.on('vault:changed', (cursor: unknown) => {
        if (typeof cursor === 'number' && Number.isSafeInteger(cursor) && cursor > 0 && cursor <= 2_147_483_647) {
          notify(cursor);
        }
      });
    });
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
