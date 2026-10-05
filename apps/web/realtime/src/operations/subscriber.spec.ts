import type { Server, Socket } from 'socket.io';

import { withCurrentSocketOwner } from '../shared/socket-authority';

import { subscribeToOperations } from './subscriber';

import { readOperation, subscribeToJson } from 'shared';

jest.mock('shared', () => {
  const { z } = jest.requireActual('zod') as typeof import('zod');

  return {
    operationChannel: 'visomi:operations:v1',
    operationIdInput: z.strictObject({ operationId: z.uuid() }),
    readOperation: jest.fn(),
    subscribeToJson: jest.fn(),
  };
});
jest.mock('../shared/socket-authority', () => ({ withCurrentSocketOwner: jest.fn() }));

const operationId = '22222222-2222-4222-8222-222222222222';
const owner = {
  userId: '44444444-4444-4444-8444-444444444444',
  accountId: '11111111-1111-4111-8111-111111111111',
  sessionId: 'session',
  authVersion: 1,
};

async function fixture() {
  let connect!: (socket: Socket) => void;
  let close!: () => void;
  const handlers = new Map<string, (input: unknown) => void>();
  const unsubscribe = jest.fn();
  const io = {
    on: (_name: string, callback: typeof connect) => {
      connect = callback;
    },
    httpServer: {
      once: (_name: string, callback: () => void) => {
        close = callback;
      },
    },
  } as unknown as Server;
  const socket = {
    connected: true,
    emit: jest.fn(),
    disconnect: jest.fn(),
    on: (name: string, callback: (input: unknown) => void) => handlers.set(name, callback),
  } as unknown as Socket;

  jest.mocked(subscribeToJson).mockResolvedValue(unsubscribe);
  jest.mocked(withCurrentSocketOwner).mockImplementation(async (_socket, run) => run(owner));
  jest.mocked(readOperation).mockResolvedValue({ operationId, status: 'pending' });
  await subscribeToOperations(io);
  connect(socket);

  return { socket, handlers, close, unsubscribe };
}

beforeEach(() => jest.clearAllMocks());
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('operation realtime delivery', () => {
  it('reloads authority for catch-up and live completion, then removes terminal watches', async () => {
    const { socket, handlers } = await fixture();

    handlers.get('operation:watch')?.({ operationId });
    await settle();
    expect(readOperation).toHaveBeenCalledWith(operationId, owner);
    expect(socket.emit).toHaveBeenCalledWith('operation:changed', { operationId, status: 'pending' });
    jest.mocked(readOperation).mockResolvedValue({ operationId, status: 'completed', result: { jobId: operationId } });
    const live = jest.mocked(subscribeToJson).mock.calls[0][1];

    await live({ operationId });
    await live({ operationId });
    expect(socket.emit).toHaveBeenCalledTimes(2);
    expect(withCurrentSocketOwner).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed watches and suppresses late delivery after unwatch', async () => {
    const { socket, handlers } = await fixture();

    handlers.get('operation:watch')?.({ operationId, secret: 'invalid' });
    await settle();
    expect(readOperation).not.toHaveBeenCalled();
    handlers.get('operation:watch')?.({ operationId });
    handlers.get('operation:unwatch')?.({ operationId });
    await settle();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('disconnects revoked owners without sending results and releases the subscriber on shutdown', async () => {
    const { socket, handlers, close, unsubscribe } = await fixture();

    jest.mocked(withCurrentSocketOwner).mockRejectedValueOnce(new Error('Revoked'));
    handlers.get('operation:watch')?.({ operationId });
    await settle();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(readOperation).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    close();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
