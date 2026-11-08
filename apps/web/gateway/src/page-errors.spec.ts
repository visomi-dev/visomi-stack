import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpError } from '@visomi-stack/web-backend-shared';
import type { Request, Response } from 'express';
import { expect, it, vi } from 'vitest';

import { pageErrors } from './page-errors';

function response() {
  return {
    set: vi.fn().mockReturnThis(),
    vary: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

it('serves immutable error documents without filesystem access on subsequent requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visomi-error-documents-'));

  try {
    for (const [path, body] of [
      ['en/system-errors/404', '<h1>Missing</h1>'],
      ['en/system-errors/4xx', '<h1>Invalid request</h1>'],
      ['es/system-errors/5xx', '<h1>Servicio no disponible</h1>'],
    ]) {
      await mkdir(join(directory, path), { recursive: true });

      await writeFile(join(directory, path, 'index.html'), body);
    }

    await mkdir(join(directory, 'en/system-errors/418'));

    await mkdir(join(directory, 'en/system-errors/private'));

    await writeFile(join(directory, 'en/system-errors/readme.txt'), 'Synthetic non-document file');

    const errors = pageErrors(directory);
    const request = (path: string) => ({ path, accepts: () => 'html' }) as unknown as Request;
    const first = response();

    await errors(new HttpError(404, 'not_found'), request('/en/missing'), first as unknown as Response, vi.fn());

    expect(first.send.mock.calls[0][0].toString()).toBe('<h1>Missing</h1>');

    await rm(directory, { recursive: true, force: true });

    for (const [status, path, body] of [
      [404, '/en/missing', '<h1>Missing</h1>'],
      [418, '/en/unknown', '<h1>Invalid request</h1>'],
      [503, '/app/es/home', '<h1>Servicio no disponible</h1>'],
    ] as const) {
      const next = response();

      await errors(new HttpError(status, 'synthetic_error'), request(path), next as unknown as Response, vi.fn());

      expect(next.status).toHaveBeenCalledWith(status);
      expect(next.send.mock.calls[0][0].toString()).toBe(body);
      expect(next.json).not.toHaveBeenCalled();
    }

    const failed = response();

    failed.send.mockImplementationOnce(() => {
      throw new Error('synthetic_delivery_failed');
    });

    await errors(new HttpError(404, 'not_found'), request('/en/missing'), failed as unknown as Response, vi.fn());

    expect(failed.json).toHaveBeenCalledWith({ error: 'not_found' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
