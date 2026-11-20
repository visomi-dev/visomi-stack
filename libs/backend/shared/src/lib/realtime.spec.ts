import { expect, it, vi } from 'vitest';

import { createMemoryRealtimeTransport, createRealtimePublisher, subscribeRealtime } from './realtime';

it('delivers events through the selected transport and detaches receivers on close', async () => {
  const transport = createMemoryRealtimeTransport();
  const publisher = createRealtimePublisher(transport);
  const sink = { notifyDeviceApproval: vi.fn(), notifySession: vi.fn(), notifyUser: vi.fn(), notifyVault: vi.fn() };

  await subscribeRealtime(transport, sink);

  await publisher.notifyDeviceApproval('synthetic-request');

  await publisher.notifySession('synthetic-session');

  await publisher.notifyUser('synthetic-user');

  await publisher.notifyVault('synthetic-scope', 7);

  expect(sink.notifyDeviceApproval).toHaveBeenCalledExactlyOnceWith('synthetic-request');
  expect(sink.notifySession).toHaveBeenCalledExactlyOnceWith('synthetic-session');
  expect(sink.notifyUser).toHaveBeenCalledExactlyOnceWith('synthetic-user');
  expect(sink.notifyVault).toHaveBeenCalledExactlyOnceWith('synthetic-scope', 7);
  transport.close();

  await publisher.notifyUser('synthetic-user');

  expect(sink.notifyUser).toHaveBeenCalledOnce();
});
