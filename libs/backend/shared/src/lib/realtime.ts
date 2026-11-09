import { InjectionToken } from './injection';

export type RealtimePublisher = {
  notifyDeviceApproval(requestId: string): Promise<void>;
  notifySession(sessionId: string): Promise<void>;
  notifyUser(userId: string): Promise<void>;
};

export type RealtimeRuntime = RealtimePublisher & { close(): Promise<void> };

export const REALTIME_PUBLISHER = new InjectionToken<RealtimePublisher>('RealtimePublisher');

const notificationMethods = {
  device: 'notifyDeviceApproval',
  session: 'notifySession',
  user: 'notifyUser',
} as const;

export type RealtimeEvent = { kind: keyof typeof notificationMethods; id: string };
type Receive = (event: RealtimeEvent) => Promise<void>;

export type RealtimeTransport = {
  publish(event: RealtimeEvent): Promise<void>;
  subscribe(receive: Receive): Promise<void>;
  close(): void;
};

export function createRealtimePublisher(transport: RealtimeTransport): RealtimePublisher {
  return {
    notifyDeviceApproval: (id) => transport.publish({ kind: 'device', id }),
    notifySession: (id) => transport.publish({ kind: 'session', id }),
    notifyUser: (id) => transport.publish({ kind: 'user', id }),
  };
}

export function subscribeRealtime(transport: RealtimeTransport, sink: RealtimePublisher): Promise<void> {
  return transport.subscribe((event) => sink[notificationMethods[event.kind]](event.id));
}

export function createMemoryRealtimeTransport(): RealtimeTransport {
  const receivers = new Set<Receive>();

  return {
    async publish(event) {
      await Promise.all([...receivers].map((receive) => receive(event)));
    },
    async subscribe(receive) {
      receivers.add(receive);
    },
    close() {
      receivers.clear();
    },
  };
}
