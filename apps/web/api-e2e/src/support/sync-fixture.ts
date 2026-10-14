import axios from 'axios';

export const password = 'S3cureAuth!';

export const cookieHeader = (setCookie: string[] | undefined) =>
  setCookie?.map((cookie) => cookie.split(';', 1)[0]).join('; ') ?? '';

export const envelope = (
  workspaceId: string,
  envelopeId: string,
  revision: number,
  tombstone = false,
  recipientDeviceId?: string,
) => ({
  format: 'themis.encrypted-envelope',
  version: 1,
  kind: 'sync-object',
  envelopeId,
  workspaceId,
  recordType: tombstone ? 'tombstone' : 'project-context',
  revision,
  createdAt: '2026-08-20T00:00:00.000Z',
  associatedData: { purpose: 'sync' },
  metadata: recipientDeviceId ? { recipientDeviceId } : tombstone ? { deletedRecordId: 'record-1' } : {},
  nonce: `bm9uY2Ut${envelopeId}`,
  ciphertext: `c3ludGhlc2lzL${envelopeId}`,
  authTag: `dGFnL${envelopeId}`,
});

export async function session(suffix: string): Promise<{
  cookie: string;
  accountId: string;
  workspaceId: string;
  deviceId: string;
  ownerDeviceId: string;
}> {
  const email = `sync-${suffix}-${Date.now()}@themis.dev`;
  const authenticated = await axios.post('/test/auth/session', { email, password });
  const cookie = cookieHeader(authenticated.headers['set-cookie']);
  const accountId = authenticated.data?.data?.accountId as string;
  const headers = { headers: { Cookie: cookie } };
  const project = await axios.post('/projects', { name: `Sync ${suffix}`, sourceType: 'manual' }, headers);
  const workspaceId = project.data.data.id as string;
  const ownerDevice = await axios.post(
    `/sync/${workspaceId}/devices`,
    { publicKey: `fixture-owner-public-${suffix}`, label: `Sync ${suffix} owner` },
    headers,
  );
  const ownerDeviceId = ownerDevice.data.data.deviceId as string;

  await axios.post(
    `/sync/${workspaceId}/devices/${ownerDeviceId}/approval`,
    { approverDeviceId: ownerDeviceId },
    headers,
  );
  const device = await axios.post(
    `/sync/${workspaceId}/devices`,
    { publicKey: `fixture-public-${suffix}`, label: `Sync ${suffix}` },
    headers,
  );
  const deviceId = device.data.data.deviceId as string;

  await axios.post(
    `/sync/${workspaceId}/devices/${deviceId}/enroll`,
    {
      approverDeviceId: ownerDeviceId,
      envelope: {
        ...envelope(workspaceId, `workspace-key-${suffix}`, 1),
        recordType: 'workspace-key-distribution',
        metadata: { recipientDeviceId: deviceId },
      },
    },
    headers,
  );

  return { accountId, cookie, workspaceId, deviceId, ownerDeviceId };
}

export async function sameWorkspaceMember(owner: Awaited<ReturnType<typeof session>>, suffix: string) {
  const email = `sync-member-${suffix}-${Date.now()}@themis.dev`;
  const authenticated = await axios.post('/test/auth/session', { email, password, accountId: owner.accountId });
  const cookie = cookieHeader(authenticated.headers['set-cookie']);
  const headers = { headers: { Cookie: cookie } };
  const device = await axios.post(
    `/sync/${owner.workspaceId}/devices`,
    { publicKey: `fixture-member-public-${suffix}`, label: `Sync member ${suffix}` },
    headers,
  );
  const deviceId = device.data.data.deviceId as string;

  await axios.post(
    `/sync/${owner.workspaceId}/devices/${deviceId}/enroll`,
    {
      approverDeviceId: owner.ownerDeviceId,
      envelope: {
        ...envelope(owner.workspaceId, `member-key-${suffix}`, 1),
        recordType: 'workspace-key-distribution',
        metadata: { recipientDeviceId: deviceId },
      },
    },
    { headers: { Cookie: owner.cookie } },
  );

  return { cookie, deviceId };
}
