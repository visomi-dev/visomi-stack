import { Redis } from 'ioredis';
import { z } from 'zod';

import type { RealtimeTransport } from './realtime';

const channel = 'visomi-stack:realtime:v1';
const envelope = z.strictObject({
  kind: z.enum(['device', 'session', 'user']),
  id: z.string().regex(/^[\w-]{1,128}$/),
});

export function createRedisRealtimeTransport(url: string, onError: () => void): RealtimeTransport {
  const endpoint = new URL(url);

  if (!['redis:', 'rediss:'].includes(endpoint.protocol)) {
    throw new Error('realtime_transport_invalid');
  }

  const publisher = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, connectTimeout: 2500 });
  let connecting: Promise<void> | undefined;
  let subscriber: Redis | undefined;

  publisher.on('error', onError);

  return {
    async publish(event) {
      if (publisher.status === 'wait') {
        connecting = publisher.connect().finally(() => {
          connecting = undefined;
        });
      }

      await connecting;

      await publisher.publish(channel, JSON.stringify(envelope.parse(event)));
    },
    async subscribe(receive) {
      if (subscriber) {
        throw new Error('realtime_transport_already_subscribed');
      }

      const client = publisher.duplicate();

      subscriber = client;
      client.on('error', onError);
      client.on('message', (_channel, message) => {
        if (message.length > 512) {
          return;
        }

        try {
          const parsed = envelope.safeParse(JSON.parse(message));

          if (parsed.success) {
            void receive(parsed.data).catch(onError);
          }
        } catch {
          // Only accept messages matching the versioned event contract.
        }
      });

      await client.connect();

      await client.subscribe(channel);
    },
    close() {
      subscriber?.disconnect();
      publisher.disconnect();
    },
  };
}
