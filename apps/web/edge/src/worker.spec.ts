import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from './worker';

afterEach(() => vi.unstubAllGlobals());

describe('edge path validation', () => {
  it.each(['%', '%zz', '%2', '%2X', '%0G', '%E0%A4%A', '%C3%28', '%FF', '%25%0G', '%/child'])(
    'rejects malformed encoding %s before contacting the origin',
    async (suffix) => {
      const forward = vi.fn();

      vi.stubGlobal('fetch', forward);
      const response = await worker.fetch(new Request(`https://stack.visomi.dev/api/${suffix}`));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body).toEqual({ error: 'request_invalid' });
      expect(forward).not.toHaveBeenCalled();
    },
  );

  it.each(['plain', '%25', '%2525', '%20', '%2F', '%C3%A9', '%F0%9F%8C%8D', '%25zz', 'plain?private=%zz'])(
    'preserves the entire original request and response for %s',
    async (suffix) => {
      const origin = new Response('SYNTHETIC_RESPONSE', {
        status: 201,
        headers: { 'content-security-policy': "script-src 'self' 'nonce-synthetic'", 'cache-control': 'no-store' },
      });
      const forward = vi.fn().mockResolvedValue(origin);
      const request = new Request(`https://stack.visomi.dev/api/${suffix}`, {
        method: 'POST',
        headers: { 'x-synthetic-header': 'SYNTHETIC_HEADER' },
        body: 'SYNTHETIC_BODY',
      });

      vi.stubGlobal('fetch', forward);
      const response = await worker.fetch(request);

      expect(response).toBe(origin);
      expect(forward).toHaveBeenCalledExactlyOnceWith(request);
      expect(request.bodyUsed).toBe(false);
      const body = await request.text();

      expect(body).toBe('SYNTHETIC_BODY');
      expect(request.headers.get('x-synthetic-header')).toBe('SYNTHETIC_HEADER');
    },
  );

  it('preserves origin failures without replacing them with invalid-request responses', async () => {
    const failure = new Error('SYNTHETIC_PRIVATE_ORIGIN_FAILURE');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));

    await expect(worker.fetch(new Request('https://stack.visomi.dev/api/'))).rejects.toBe(failure);
  });
});
