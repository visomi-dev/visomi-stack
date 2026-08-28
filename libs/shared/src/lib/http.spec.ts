import { HttpError, redactedErrorDetails } from './http';

describe('HttpError', () => {
  it('stores response metadata', () => {
    const error = new HttpError({
      code: 'bad_request',
      data: { field: 'email' },
      message: 'Invalid request.',
      statusCode: 400,
    });

    expect(error.code).toBe('bad_request');
    expect(error.data).toEqual({ field: 'email' });
    expect(error.message).toBe('Invalid request.');
    expect(error.statusCode).toBe(400);
  });

  it('redacts error payloads and messages before audit logging', () => {
    const error = new HttpError({
      code: 'challenge_mismatch',
      data: { challenge: 'secret-challenge', credentialId: 'secret-credential' },
      message: 'secret challenge details',
      statusCode: 400,
    });

    expect(redactedErrorDetails(error)).toEqual({ code: 'challenge_mismatch', statusCode: 400 });
    expect(JSON.stringify(redactedErrorDetails(error))).not.toContain('secret');
  });
});
