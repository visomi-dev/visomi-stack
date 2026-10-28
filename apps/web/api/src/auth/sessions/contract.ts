import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import {
  commonErrors,
  cookieSecurity,
  csrfSecurity,
  emptyBody,
  expirySchema,
  mutationDescription,
  sessionSchema,
  validationErrors,
} from '../shared/contracts';

const sessionEntrySchema = z.object({
  id: z.string(),
  current: z.boolean(),
  createdAt: expirySchema,
  expiresAt: expirySchema,
  method: z.enum(['passkey', 'password', 'google', 'recovery', 'device']).optional(),
});

export const sessionsContracts = {
  getSession: defineRoute({
    validationErrors,
    method: 'get',
    path: '/session',
    operationId: 'sessions_getSession',
    summary: 'Read the current session',
    tags: ['sessions'],
    description: 'Requires a full verified session where documented; recent proof is required for management changes.',
    security: [],
    request: z.object({}),
    responses: {
      ...commonErrors,
      200: {
        description: 'Public session state, access level, next step and CSRF token.',
        content: { 'application/json': { schema: sessionSchema } },
      },
    },
  }),
  logout: defineRoute({
    validationErrors,
    method: 'post',
    path: '/logout',
    operationId: 'sessions_logout',
    summary: 'Log out',
    tags: ['sessions'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: emptyBody }),
    responses: { ...commonErrors, 204: { description: 'Session revoked and cookie cleared.' } },
  }),
  listSessions: defineRoute({
    validationErrors,
    method: 'get',
    path: '/sessions',
    operationId: 'sessions_listSessions',
    summary: 'List account sessions',
    tags: ['sessions'],
    description: 'Requires a full verified session where documented; recent proof is required for management changes.',
    security: cookieSecurity,
    request: z.object({}),
    responses: {
      ...commonErrors,
      200: {
        description: 'Owned sessions with opaque handles; no address or user-agent metadata.',
        content: { 'application/json': { schema: z.object({ sessions: z.array(sessionEntrySchema) }) } },
      },
    },
  }),
  closeSession: defineRoute({
    validationErrors,
    method: 'delete',
    path: '/sessions/:id',
    operationId: 'sessions_closeSession',
    summary: 'Revoke a session',
    tags: ['sessions'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ params: z.object({ id: z.string().min(1).max(64) }) }),
    responses: { ...commonErrors, 204: { description: 'Owned session revoked after recent authentication.' } },
  }),
  revokeOtherSessions: defineRoute({
    validationErrors,
    method: 'post',
    path: '/sessions/revoke-others',
    operationId: 'sessions_revokeOtherSessions',
    summary: 'Revoke other sessions',
    tags: ['sessions'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: emptyBody }),
    responses: { ...commonErrors, 204: { description: 'Other sessions revoked after recent authentication.' } },
  }),
};
