import { generateKeyPairSync } from 'node:crypto';

import express from 'express';
import request from 'supertest';

import { createGatewayApp } from './gateway';
import { createLocalAgentProxy } from './local-agent-proxy';

import { signLocalAgentHandshake, type LocalAgentHandshakeChallenge } from 'shared';

describe('local-agent gateway handshake', () => {
  it('rejects a loopback response with a forged signature', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const forgedResponse = Buffer.from(
      JSON.stringify({
        deviceId: 'device-1',
        nonce: 'forged',
        origin: 'http://localhost',
        sessionId: 'forged',
        signature: Buffer.from('not-a-signature').toString('base64url'),
      }),
      'utf8',
    ).toString('base64url');

    const app = createGatewayApp({
      apiHandler: express(),
      angularHandler: express(),
      astroClientFolder: __dirname,
      astroRequestHandler: (_req, res) => {
        res.sendStatus(404);
      },
      authRuntimeHandlers: [
        (req, _res, next) => {
          req.headers.origin = 'http://localhost';
          next();
        },
      ],
      localAgentHandler: createLocalAgentProxy({
        publicKey,
        replayStore: { claim: async () => true },
        target: new URL('http://local-agent.test'),
        fetchImpl: async () =>
          new Response(JSON.stringify({ context: 'must-not-cross-boundary' }), {
            headers: { 'content-type': 'application/json', 'x-themis-handshake-response': forgedResponse },
          }),
      }),
    });

    const response = await request(app).get('/v1/product-visibility/projects/project-1').set('Cookie', 'sid=session');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('local_agent_handshake_failed');
    expect(response.text).not.toContain('must-not-cross-boundary');
  });

  it('authenticates the real response and rejects replay through the durable boundary', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    let claimed = false;
    const handler = createLocalAgentProxy({
      publicKey,
      replayStore: { claim: async () => !claimed && (claimed = true) },
      target: new URL('http://local-agent.test'),
      fetchImpl: async (_input, init) => {
        const challenge = JSON.parse(
          Buffer.from(
            String((init?.headers as Record<string, string>)['x-themis-handshake-challenge']),
            'base64url',
          ).toString(),
        ) as LocalAgentHandshakeChallenge;
        const response = signLocalAgentHandshake(challenge, 'device-1', privateKey);

        return new Response(JSON.stringify({ state: 'authorized' }), {
          headers: {
            'content-type': 'application/json',
            'x-themis-handshake-response': Buffer.from(JSON.stringify(response)).toString('base64url'),
          },
        });
      },
    });
    const gateway = express();

    gateway.use('/v1/product-visibility', handler);

    expect((await request(gateway).get('/v1/product-visibility/projects/project-1')).status).toBe(200);
    expect((await request(gateway).get('/v1/product-visibility/projects/project-1')).status).toBe(403);
  });

  it('fails closed for malformed handshake responses', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const malformed = createLocalAgentProxy({
      publicKey,
      replayStore: { claim: async () => true },
      target: new URL('http://local-agent.test'),
      fetchImpl: async () =>
        new Response('protected body', {
          headers: { 'x-themis-handshake-response': Buffer.from('{not-json').toString('base64url') },
        }),
    });
    const malformedGateway = express();

    malformedGateway.use('/v1/product-visibility', malformed);

    const malformedResponse = await request(malformedGateway).get('/v1/product-visibility/projects/project-1');

    expect(malformedResponse.status).toBe(403);
    expect(malformedResponse.text).not.toContain('protected body');
  });
});
