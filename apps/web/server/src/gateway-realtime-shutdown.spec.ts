import { once } from 'node:events';
import { createServer, get } from 'node:http';
import type { ServerResponse } from 'node:http';

import { Server } from 'socket.io';
import { io } from 'socket.io-client';

import { stopGatewayRuntime } from './gateway-shutdown';

test.each(['websocket', 'polling'] as const)(
  'shutdown closes the real %s transport while draining an active HTTP response',
  async (transport) => {
    let activeResponse: ServerResponse | undefined;
    let receivedRequest: (() => void) | undefined;
    const received = new Promise<void>((done) => {
      receivedRequest = done;
    });
    const server = createServer((_request, response) => {
      activeResponse = response;
      receivedRequest?.();
    });
    const realtime = new Server(server);

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Missing synthetic listener address');
    }

    const url = `http://127.0.0.1:${address.port}`;
    const socket = io(url, { transports: [transport], reconnection: false });

    try {
      await new Promise<void>((connected, failed) => {
        socket.once('connect', connected);
        socket.once('connect_error', failed);
      });
      expect(socket.connected).toBe(true);
      const request = get(`${url}/pending`, { agent: false });
      const responseReceived = once(request, 'response');

      await received;
      expect(activeResponse).toBeDefined();
      const disconnected = new Promise<void>((done) => socket.once('disconnect', () => done()));
      const exit = jest.fn();
      const listenerClosed = once(server, 'close');

      stopGatewayRuntime({ worker: undefined, server, realtime, exit });
      await disconnected;
      expect(socket.connected).toBe(false);
      expect(exit).not.toHaveBeenCalled();
      activeResponse?.end('Synthetic response completed');
      const [response] = await responseReceived;
      const chunks: Buffer[] = [];

      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      await once(response, 'end');
      await listenerClosed;
      expect(Buffer.concat(chunks).toString()).toBe('Synthetic response completed');
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      activeResponse?.end();
      socket.close();
      await realtime.close();
    }
  },
);
