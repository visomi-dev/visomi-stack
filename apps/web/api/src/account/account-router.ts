import { Router } from 'express';
import type { Request, Response } from 'express';

import { authed, authedRequest } from '../auth/auth-middleware';
import { csrfProtection } from '../auth/passkey-security';
import { clearSessionHintCookie } from '../auth/session-cookie';
import { getValidated, validateRequest } from '../shared/http/route-schemas';

import {
  emailChangeSchema,
  emailVerifySchema,
  leaveWorkspaceSchema,
  profileUpdateSchema,
  transferOwnershipSchema,
} from './account-schemas';
import {
  exportProfile,
  getProfile,
  leaveWorkspace,
  requestEmailChange,
  transferWorkspaceOwnership,
  updateProfile,
  verifyEmailChange,
} from './account-service';
import type { AccountContext } from './account-service';

import { HttpError } from 'shared';

function context(req: Request): AccountContext {
  const { user } = authedRequest(req);

  if (!user.authVersion)
    throw new HttpError({ code: 'authentication_required', message: 'Sign in again.', statusCode: 401 });

  return { userId: user.id, accountId: user.accountId, authVersion: user.authVersion, sessionBinding: req.sessionID };
}

// Database authVersion invalidation is authoritative even if session-store cleanup fails.
async function endSession(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie('connect.sid');
  clearSessionHintCookie(res);
}

export const accountRouter = Router();
accountRouter.use(csrfProtection, authed({ authority: 'full' }), (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
accountRouter.get('/profile', async (req, res) => {
  res.json({ data: await getProfile(context(req)), message: 'Account profile.' });
});
accountRouter.patch('/profile', validateRequest({ body: profileUpdateSchema }), async (req, res) => {
  const { body } = getValidated<{ body: typeof profileUpdateSchema }>(req);

  res.json({ data: await updateProfile(context(req), body), message: 'Profile updated.' });
});
accountRouter.get('/export', async (req, res) => {
  const data = await exportProfile(context(req));

  res.setHeader('Content-Disposition', 'attachment; filename="profile-membership-metadata.json"');
  res.json({ data, message: 'Profile and membership metadata only.' });
});
accountRouter.post(
  '/email/request',
  validateRequest({ body: emailChangeSchema }),
  authed({ operation: { purpose: 'email_change', grantSource: 'body' } }),
  async (req, res) => {
    const { body } = getValidated<{ body: typeof emailChangeSchema }>(req);

    res.json({ data: await requestEmailChange(context(req), body.email), message: 'Verify your new email address.' });
  },
);
accountRouter.post('/email/verify', validateRequest({ body: emailVerifySchema }), async (req, res) => {
  const { body } = getValidated<{ body: typeof emailVerifySchema }>(req);
  const data = await verifyEmailChange(context(req), body.flowId, body.pin);

  await endSession(req, res);
  res.json({
    data,
    message:
      data.notification === 'sent'
        ? 'Email changed. Sign in again.'
        : 'Email changed. Notification to your previous address failed. Sign in again.',
  });
});
accountRouter.post(
  '/workspace/transfer',
  validateRequest({ body: transferOwnershipSchema }),
  authed({ operation: { purpose: 'workspace_leave', grantSource: 'body' } }),
  async (req, res) => {
    const { body } = getValidated<{ body: typeof transferOwnershipSchema }>(req);

    res.json({
      data: await transferWorkspaceOwnership(context(req), body.targetUserId),
      message: 'Workspace ownership transferred.',
    });
  },
);
accountRouter.post(
  '/workspace/leave',
  validateRequest({ body: leaveWorkspaceSchema }),
  authed({ operation: { purpose: 'workspace_leave', grantSource: 'body' } }),
  async (req, res) => {
    const data = await leaveWorkspace(context(req));

    await endSession(req, res);
    res.json({ data, message: 'You left this workspace. Your identity and other memberships are preserved.' });
  },
);
