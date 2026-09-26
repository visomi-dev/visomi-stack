import { randomUUID } from 'node:crypto';

import axios from 'axios';

const origin = 'http://localhost:8080';
const config = (cookie: string) => ({ headers: { Origin: origin, Cookie: cookie } });
const cookies = (values?: string[]) => values?.map((value) => value.split(';', 1)[0]).join('; ') ?? '';

describe('device approval lifecycle over HTTP', () => {
  it('serializes approval against denial and consumption against requester cancellation', async () => {
    const email = `approval-terminal-race-${randomUUID()}@example.test`;
    const session = await axios.post('/test/auth/session', { email });
    const second = await axios.post('/test/auth/session', { email });
    const requester = config(cookies(session.headers['set-cookie']));
    const approver = config(cookies(second.headers['set-cookie']));
    const pending = await axios.post(
      '/auth/device-approval/request',
      { accountId: session.data.data.accountId },
      requester,
    );
    const firstId = pending.data.data.requestId as string;
    const decisions = await Promise.allSettled([
      axios.post('/auth/device-approval/approve', { requestId: firstId }, approver),
      axios.post('/auth/device-approval/deny', { requestId: firstId }, approver),
    ]);

    expect(decisions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const created = await axios.post(
      '/auth/device-approval/request',
      { accountId: session.data.data.accountId },
      requester,
    );
    const { requestId, userCode } = created.data.data as { requestId: string; userCode: string };

    await axios.post('/auth/device-approval/approve', { requestId }, approver);
    const terminal = await Promise.allSettled([
      axios.post('/auth/device-approval/consume', { requestId, userCode }, requester),
      axios.post('/auth/device-approval/cancel', { requestId }, requester),
    ]);

    expect(terminal.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const status = await axios.post('/auth/device-approval/status', { requestId }, requester);

    expect(['consumed', 'cancelled']).toContain(status.data.data.status);
    await expect(axios.post('/auth/device-approval/consume', { requestId, userCode }, requester)).rejects.toMatchObject(
      { response: { status: 401 } },
    );
  });
  it('keeps review private, prevents self-approval, and makes cancellation terminal', async () => {
    const email = `approval-${randomUUID()}@example.test`;
    const requesterSession = await axios.post('/test/auth/session', { email });
    const approverSession = await axios.post('/test/auth/session', { email });
    const outsiderSession = await axios.post('/test/auth/session', { email: `outsider-${randomUUID()}@example.test` });
    const requester = config(cookies(requesterSession.headers['set-cookie']));
    const approver = config(cookies(approverSession.headers['set-cookie']));
    const outsider = config(cookies(outsiderSession.headers['set-cookie']));
    const created = await axios.post(
      '/auth/device-approval/request',
      { accountId: requesterSession.data.data.accountId },
      requester,
    );
    const { requestId, userCode } = created.data.data as { requestId: string; userCode: string };

    await expect(axios.post('/auth/device-approval/review', { requestId }, outsider)).rejects.toMatchObject({
      response: { status: 404 },
    });
    await expect(axios.post('/auth/device-approval/approve', { requestId }, requester)).rejects.toMatchObject({
      response: { status: 409 },
    });
    const review = await axios.post('/auth/device-approval/review', { requestId }, approver);

    expect(review.data.data).toMatchObject({ requester: false, status: 'pending' });
    expect(review.data.data.userCode).toBeUndefined();
    await axios.post('/auth/device-approval/cancel', { requestId }, requester);
    await expect(axios.post('/auth/device-approval/approve', { requestId }, approver)).rejects.toMatchObject({
      response: { status: 409 },
    });
    await expect(axios.post('/auth/device-approval/consume', { requestId, userCode }, requester)).rejects.toMatchObject(
      { response: { status: 401 } },
    );
    expect((await axios.post('/auth/device-approval/status', { requestId }, requester)).data.data.status).toBe(
      'cancelled',
    );
  });

  it('allows only one approved consume when concurrent requests race over HTTP', async () => {
    const email = `approval-race-${randomUUID()}@example.test`;
    const session = await axios.post('/test/auth/session', { email });
    const second = await axios.post('/test/auth/session', { email });
    const requester = config(cookies(session.headers['set-cookie']));
    const approver = config(cookies(second.headers['set-cookie']));
    const created = await axios.post(
      '/auth/device-approval/request',
      { accountId: session.data.data.accountId },
      requester,
    );
    const { requestId, userCode } = created.data.data as { requestId: string; userCode: string };

    await axios.post('/auth/device-approval/approve', { requestId }, approver);
    const results = await Promise.allSettled([
      axios.post('/auth/device-approval/consume', { requestId, userCode }, requester),
      axios.post('/auth/device-approval/consume', { requestId, userCode }, requester),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await axios.post('/auth/device-approval/status', { requestId }, requester)).data.data.status).toBe(
      'consumed',
    );
  });
});
