import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { writeResponse } from 'astro/app/node';
import { expect, it, vi } from 'vitest';

it('does not log request data or exception details if a response cancellation fails', async () => {
  const request = new IncomingMessage(new Socket());
  const destination = new ServerResponse(request);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  request.url = '/en/?private=synthetic_private_query';
  vi.spyOn(destination, 'writeHead').mockReturnValue(destination);
  vi.spyOn(destination, 'write').mockImplementation(() => {
    destination.emit('close');

    return true;
  });
  vi.spyOn(destination, 'end').mockReturnValue(destination);
  const source = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        return Promise.reject(new Error('synthetic_private_exception'));
      },
    }),
  );

  try {
    await writeResponse(source, destination);

    await vi.waitFor(() => {
      expect(errors.mock.calls).toEqual([['site_response_cancel_failed']]);
    });
  } finally {
    errors.mockRestore();
  }
});
