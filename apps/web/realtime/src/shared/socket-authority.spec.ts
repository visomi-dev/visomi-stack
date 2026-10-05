import type { Socket } from 'socket.io';

import { withCurrentSocketOwner } from './socket-authority';

import { hasOperationMembership } from 'shared';

jest.mock('shared', () => ({ hasOperationMembership: jest.fn(), isSessionAuthorityStore: () => true }));

function fixture() {
  const user = {
    id: '44444444-4444-4444-8444-444444444444',
    accountId: '11111111-1111-4111-8111-111111111111',
    authVersion: 1,
  };
  const session = {
    authority: 'full',
    passport: { user },
    reload: jest.fn((callback: (error?: unknown) => void) => callback()),
  };
  const authority = jest.fn(async (_scope: unknown, run: () => Promise<void>) => run());
  const socket = {
    request: { session, sessionID: 'session', sessionStore: { withSessionAuthority: authority } },
  } as unknown as Socket;

  return { socket, session, authority };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(hasOperationMembership).mockResolvedValue(true);
});

describe('current socket authority', () => {
  it('reloads before and inside the lease and passes only current account context', async () => {
    const { socket, session } = fixture();
    const deliver = jest.fn();

    await withCurrentSocketOwner(socket, deliver);
    expect(session.reload).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledWith({
      sessionId: 'session',
      userId: session.passport.user.id,
      accountId: session.passport.user.accountId,
      authVersion: 1,
    });
  });

  it('rejects account changes while waiting for the lease and removed memberships', async () => {
    const { socket, session, authority } = fixture();
    const deliver = jest.fn();

    authority.mockImplementationOnce(async (_scope, run) => {
      session.passport.user.accountId = '22222222-2222-4222-8222-222222222222';
      await run();
    });
    await expect(withCurrentSocketOwner(socket, deliver)).rejects.toThrow('Socket scope changed');
    jest.mocked(hasOperationMembership).mockResolvedValue(false);
    await expect(withCurrentSocketOwner(socket, deliver)).rejects.toThrow('Socket authority was revoked');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('fails closed for revoked and restricted sessions without delivering a snapshot', async () => {
    const { socket, session, authority } = fixture();
    const deliver = jest.fn();

    authority.mockRejectedValueOnce(new Error('Revoked'));
    await expect(withCurrentSocketOwner(socket, deliver)).rejects.toThrow('Revoked');
    session.authority = 'restricted';
    await expect(withCurrentSocketOwner(socket, deliver)).rejects.toThrow();
    expect(deliver).not.toHaveBeenCalled();
  });
});
