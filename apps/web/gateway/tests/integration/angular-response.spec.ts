import '@angular/compiler';

import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { writeResponseToNodeResponse } from '@angular/ssr/node';
import { expect, it, vi } from 'vitest';

it('does not log request data or exception details when Angular response cancellation fails', async () => {
  const request = new IncomingMessage(new Socket());
  const destination = new ServerResponse(request);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const cancel = vi.fn(() => Promise.reject(new Error('SYNTHETIC_PRIVATE_STREAM_ERROR')));

  request.url = '/app/en/?private=SYNTHETIC_PRIVATE_QUERY';
  vi.spyOn(destination, 'flushHeaders').mockImplementation(() => undefined);
  vi.spyOn(destination, 'write').mockImplementation(() => {
    destination.emit('close');

    return true;
  });
  const source = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    }),
  );

  try {
    await writeResponseToNodeResponse(source, destination);

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());

    expect(errors).not.toHaveBeenCalled();
    expect(destination.listenerCount('close')).toBe(0);
    expect(destination.listenerCount('error')).toBe(0);
  } finally {
    errors.mockRestore();
  }
});
