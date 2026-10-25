import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { authErrorHandler, saveSession } from './router';
import { AuthError } from './security';

describe('authentication HTTP boundary', () => {
  it('saves the session before returning and sanitizes failed persistence', async () => {
    const save = vi.fn((callback: (error?: Error) => void) => callback());

    await saveSession({ session: { save } } as unknown as Request);
    expect(save).toHaveBeenCalledOnce();
    save.mockImplementation((callback) => callback(new Error('SYNTHETIC_PRIVATE_SQL')));
    await expect(saveSession({ session: { save } } as unknown as Request)).rejects.toMatchObject({
      code: 'session_unavailable',
    });
  });

  it.each([
    [new AuthError('authentication_required', 401), 401, 'authentication_required'],
    [new Error('SYNTHETIC_PRIVATE_SQL_PARAMETERS'), 503, 'authentication_unavailable'],
  ])('returns only a controlled status and error code', (error, status, code) => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    authErrorHandler(error, {} as Request, response, vi.fn());
    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledWith({ error: code });
  });

  it('delegates a started response to the existing operational error handler', () => {
    const next = vi.fn();
    const error = new Error('SYNTHETIC_PRIVATE_ERROR');

    authErrorHandler(error, {} as Request, { headersSent: true } as Response, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});
