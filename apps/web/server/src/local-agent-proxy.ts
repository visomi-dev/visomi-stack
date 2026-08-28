import { createPublicKey, createHash, randomUUID, type KeyObject } from 'node:crypto';

import type { RequestHandler } from 'express';

import {
  createLocalAgentChallenge,
  handshakeReplayKey,
  verifyLocalAgentHandshake,
  type LocalAgentHandshakeResponse,
  redactedDiagnostic,
} from 'shared';

type ReplayStore = {
  claim(key: string): Promise<boolean>;
};

type LocalAgentProxyOptions = {
  publicKey: KeyObject;
  target: URL;
  replayStore: ReplayStore;
  fetchImpl?: typeof fetch;
  expectedDeviceId?: string;
};

function sessionBinding(req: { headers: Record<string, string | string[] | undefined> }): string {
  const cookie = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';

  return createHash('sha256').update(cookie).digest('base64url');
}

function createLocalAgentProxy({
  publicKey,
  target,
  replayStore,
  fetchImpl = fetch,
  expectedDeviceId,
}: LocalAgentProxyOptions): RequestHandler {
  return async (req, res) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : `${req.protocol}://${req.get('host')}`;
    const challenge = createLocalAgentChallenge(origin, sessionBinding(req));
    const upstream = new URL(
      `${target.toString().replace(/\/$/, '')}${req.originalUrl.replace(/^\/v1\/(?:browser-vault|product-visibility|local-agent)/, '')}`,
    );

    try {
      const upstreamResponse = await fetchImpl(upstream, {
        headers: {
          accept: 'application/json',
          'x-themis-bridge-capabilities': 'projection',
          'x-themis-bridge-version': '1',
          'x-themis-projection-format':
            req.originalUrl.startsWith('/v1/browser-vault/') || req.originalUrl.startsWith('/v1/product-visibility/')
              ? 'browser'
              : 'agent',
          cookie: typeof req.headers.cookie === 'string' ? req.headers.cookie : '',
          'x-themis-handshake-challenge': Buffer.from(JSON.stringify(challenge), 'utf8').toString('base64url'),
        },
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      const responseHeader = upstreamResponse.headers.get('x-themis-handshake-response');

      if (!upstreamResponse.ok || !responseHeader) {
        res.status(upstreamResponse.status === 401 || upstreamResponse.status === 403 ? 403 : 503).json({
          code: 'local_agent_handshake_failed',
          message: 'The local agent did not authenticate the visibility request.',
        });

        return;
      }

      let response: LocalAgentHandshakeResponse;

      try {
        response = JSON.parse(Buffer.from(responseHeader, 'base64url').toString('utf8')) as LocalAgentHandshakeResponse;
      } catch {
        res
          .status(403)
          .json({ code: 'local_agent_handshake_failed', message: 'The local agent handshake was rejected.' });

        return;
      }

      if (
        !verifyLocalAgentHandshake(challenge, response, publicKey) ||
        (expectedDeviceId !== undefined && response.deviceId !== expectedDeviceId) ||
        !(await replayStore.claim(handshakeReplayKey(response)))
      ) {
        res
          .status(403)
          .json({ code: 'local_agent_handshake_failed', message: 'The local agent handshake was rejected.' });

        return;
      }

      const body = await upstreamResponse.text();

      if (Buffer.byteLength(body, 'utf8') > 64 * 1024) {
        res.status(502).json({
          code: 'local_agent_projection_unsafe',
          message: 'The local agent projection exceeded its safe bound.',
        });

        return;
      }

      res.status(200).set('cache-control', 'no-store').type('application/json').send(body);
    } catch (error: unknown) {
      const diagnostic = redactedDiagnostic('local_agent_unavailable', error, randomUUID());

      res.status(503).json(diagnostic);
    }
  };
}

function publicKeyFromPem(pem: string | undefined): KeyObject | undefined {
  return pem ? createPublicKey(pem) : undefined;
}

export { createLocalAgentProxy, publicKeyFromPem };
export type { ReplayStore };
