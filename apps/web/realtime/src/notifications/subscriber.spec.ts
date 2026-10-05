import { EventEmitter } from 'node:events';

import type { Server, Socket } from 'socket.io';

import { withCurrentSocketOwner } from '../shared/socket-authority';

import { subscribeToNotifications } from './subscriber';

import { subscribeToJson } from 'shared';
import type { OperationOwner } from 'shared';

jest.mock('../shared/socket-authority', () => ({ withCurrentSocketOwner: jest.fn() }));
jest.mock('shared', () => {
  const { z } = jest.requireActual<typeof import('zod')>('zod');

  return {
    notificationChannel: 'visomi:notifications:v1',
    notificationHint: z.strictObject({ accountId: z.uuid(), userId: z.uuid() }),
    subscribeToJson: jest.fn(),
  };
});

const owner: OperationOwner = {
  accountId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  sessionId: 'session',
  authVersion: 1,
};
const hint = { accountId: owner.accountId, userId: owner.userId };

async function fixture() {
  const server = new EventEmitter();
  const transport = new EventEmitter();
  const socketEvents = new EventEmitter();
  const emit = jest.fn();
  const disconnect = jest.fn();
  const socket = { on: socketEvents.on.bind(socketEvents), emit, disconnect, connected: true } as unknown as Socket;
  const unsubscribe = jest.fn();

  jest.mocked(subscribeToJson).mockResolvedValue(unsubscribe);
  jest.mocked(withCurrentSocketOwner).mockImplementation(async (_socket, deliver) => deliver(owner));
  await subscribeToNotifications({ on: server.on.bind(server), httpServer: transport } as unknown as Server);
  server.emit('connection', socket);
  const publish = jest.mocked(subscribeToJson).mock.calls[0][1];
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

  return { socketEvents, emit, disconnect, transport, unsubscribe, publish, settle };
}

beforeEach(() => jest.clearAllMocks());

describe('session-bound notification invalidation', () => {
  it('catches up on subscription, emits no owner/content and ignores foreign or malformed hints', async () => {
    const target = await fixture();

    target.socketEvents.emit('notifications:watch');
    await target.settle();
    expect(target.emit).toHaveBeenCalledWith('notifications:changed', {});
    target.emit.mockClear();
    await target.publish({ ...hint, userId: '33333333-3333-4333-8333-333333333333' });
    await target.publish({ ...hint, accountId: '33333333-3333-4333-8333-333333333333' });
    await target.publish({ ...hint, plaintext: 'reject' });
    expect(target.emit).not.toHaveBeenCalled();
    await target.publish(hint);
    expect(target.emit).toHaveBeenCalledTimes(1);
    target.socketEvents.emit('notifications:unwatch');
    await target.publish(hint);
    expect(target.emit).toHaveBeenCalledTimes(1);
    target.transport.emit('close');
    expect(target.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('rechecks live authority and disconnects a watch after revocation or account/session version change', async () => {
    const target = await fixture();

    target.socketEvents.emit('notifications:watch');
    await target.settle();
    target.emit.mockClear();
    jest
      .mocked(withCurrentSocketOwner)
      .mockImplementationOnce(async (_socket, deliver) => deliver({ ...owner, authVersion: 2 }));
    await target.publish(hint);
    expect(target.emit).not.toHaveBeenCalled();
    expect(target.disconnect).toHaveBeenCalledWith(true);
    target.socketEvents.emit('notifications:watch');
    await target.settle();
    target.emit.mockClear();
    jest.mocked(withCurrentSocketOwner).mockRejectedValueOnce(new Error('Revoked'));
    await target.publish(hint);
    expect(target.emit).not.toHaveBeenCalled();
    expect(target.disconnect).toHaveBeenCalledTimes(2);
  });

  it('keeps one bounded watch and does not emit after unwatch while awaiting authority', async () => {
    const target = await fixture();
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });

    jest.mocked(withCurrentSocketOwner).mockImplementationOnce(async (_socket, deliver) => {
      await waiting;
      await deliver(owner);
    });
    target.socketEvents.emit('notifications:watch');
    target.socketEvents.emit('notifications:watch');
    expect(withCurrentSocketOwner).toHaveBeenCalledTimes(1);
    target.socketEvents.emit('notifications:unwatch');
    release?.();
    await target.settle();
    expect(target.emit).not.toHaveBeenCalled();
    target.socketEvents.emit('notifications:watch');
    await target.settle();
    target.emit.mockClear();
    target.socketEvents.emit('disconnect');
    await target.publish(hint);
    expect(target.emit).not.toHaveBeenCalled();
  });
});
