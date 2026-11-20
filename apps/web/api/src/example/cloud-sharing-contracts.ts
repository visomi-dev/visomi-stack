import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import { targetSchema } from '../access/contracts';
import { emailSchema } from '../auth/email/schema';
import { commonErrors, cookieSecurity, csrfSecurity } from '../auth/shared/contracts';

const path = '/tenants/:tenantId/scopes/:scopeId/sharing';
const response = (schema: z.ZodType) => ({
  ...commonErrors,
  200: { description: 'Authorized Cloud sharing result', content: { 'application/json': { schema } } },
});
const action = { tags: ['persistence'], security: csrfSecurity };
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const changed = z.strictObject({ changed: z.literal(true) });

export const cloudSharingContracts = {
  list: defineRoute({
    ...action,
    method: 'get',
    path,
    operationId: 'cloud_list_readers',
    summary: 'Read the owner’s sharing settings',
    security: cookieSecurity,
    request: z.object({ params: targetSchema }),
    responses: response(
      z.strictObject({
        linkExpiresAt: z.iso.datetime().nullable(),
        readers: z.array(z.strictObject({ id: z.uuid(), email: z.email() })),
      }),
    ),
  }),
  createLink: defineRoute({
    ...action,
    method: 'post',
    path: `${path}/link`,
    operationId: 'cloud_create_share_link',
    summary: 'Create or replace a link for verified accounts',
    request: z.object({ params: targetSchema, body: z.strictObject({}) }),
    responses: response(z.strictObject({ token, expiresAt: z.iso.datetime() })),
  }),
  disableLink: defineRoute({
    ...action,
    method: 'delete',
    path: `${path}/link`,
    operationId: 'cloud_disable_share_link',
    summary: 'Disable future access through the current link',
    request: z.object({ params: targetSchema }),
    responses: response(changed),
  }),
  redeem: defineRoute({
    ...action,
    method: 'post',
    path: '/sharing/join',
    operationId: 'cloud_redeem_share_link',
    summary: 'Join a Cloud workspace as a verified reader',
    request: z.object({ body: z.strictObject({ token }) }),
    responses: response(targetSchema),
  }),
  email: defineRoute({
    ...action,
    method: 'post',
    path: `${path}/email`,
    operationId: 'cloud_share_with_email',
    summary: 'Grant read access and email an existing verified account',
    request: z.object({
      params: targetSchema,
      body: z.strictObject({ email: emailSchema, locale: z.enum(['en', 'es']) }),
    }),
    responses: response(z.strictObject({ sent: z.boolean() })),
  }),
  revoke: defineRoute({
    ...action,
    method: 'delete',
    path: `${path}/readers/:userId`,
    operationId: 'cloud_remove_reader',
    summary: 'Remove a reader’s access to this Cloud workspace',
    request: z.object({ params: targetSchema.extend({ userId: z.uuid() }) }),
    responses: response(changed),
  }),
};
