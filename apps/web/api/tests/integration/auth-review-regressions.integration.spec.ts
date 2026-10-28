import { randomUUID } from 'node:crypto';

import { authSchema } from '@visomi-stack/backend-shared';
import { authenticator } from '@visomi-stack/dev-testing';
import { and, eq, isNull } from 'drizzle-orm';
import { generate } from 'otplib';
import { expect, it, vi } from 'vitest';

import { authenticationFixture, password } from './support/auth';

const f = authenticationFixture();

type Browser = Awaited<ReturnType<typeof f.client>>;
async function storedPrincipal(browser: Browser) {
  const result = await f.pool.query(
    "select sess->'passport'->'user' as principal from auth_sessions where sess->>'csrf' = $1",
    [browser.csrf],
  );

  return result.rows[0].principal;
}

it.each(['password', 'backups', 'remove-totp', 'replace-totp', 'email', 'passkey'])(
  'preserves authentication proof after %s management and requires reauthentication after five minutes',
  async (operation) => {
    const { browser } = await f.signup();
    const setup = await browser.call('POST', '/totp/setup', {});
    const code = await generate({ secret: setup.data.secret });
    const confirmed = await browser.call('POST', '/totp/confirm', {
      enrollmentId: setup.data.enrollmentId,
      code,
    });
    const start = await browser.call('POST', '/reauth/password/start', { password });
    const verified = await browser.call('POST', '/reauth/password/complete', {
      flowId: start.data.flowId,
      factor: { kind: 'recovery_code', code: confirmed.data.recoveryCodes[0] },
    });

    expect(verified.status).toBe(200);
    const proofTime = Date.now() - 240_000;

    await f.pool.query(
      "update auth_sessions set sess = jsonb_set(sess, '{passport,user,authenticatedAt}', to_jsonb($1::bigint)) where sess->>'csrf' = $2",
      [proofTime, browser.csrf],
    );

    let result;

    if (operation === 'password') {
      const changed = await browser.call('POST', '/password/change', { password: 'Synthetic replacement password!' });

      result = changed;
    } else if (operation === 'backups') {
      const changed = await browser.call('POST', '/recovery-codes/regenerate', {});

      result = changed;
    } else if (operation === 'remove-totp') {
      const changed = await browser.call('DELETE', '/totp');

      result = changed;
    } else if (operation === 'replace-totp') {
      const next = await browser.call('POST', '/totp/setup', {});

      const code = await generate({ secret: next.data.secret });
      const changed = await browser.call('POST', '/totp/confirm', {
        enrollmentId: next.data.enrollmentId,
        code,
      });

      result = changed;
    } else if (operation === 'email') {
      const nextEmail = `${randomUUID()}@example.test`;
      const next = await browser.call('POST', '/email/change/request', { email: nextEmail });

      const changed = await browser.call('POST', '/email/change/verify', {
        flowId: next.data.flowId,
        code: f.lastCode(nextEmail),
      });

      result = changed;
    } else {
      const device = authenticator();
      const options = await browser.call('POST', '/passkeys/registration/options', {});

      const changed = await browser.call('POST', '/passkeys/registration/verify', {
        challengeId: options.data.challengeId,
        response: device.register(options.data.options.challenge, f.origin, '127.0.0.1'),
      });

      result = changed;
    }

    expect(result.status).toBe(operation === 'passkey' ? 201 : 200);
    const stored = await storedPrincipal(browser);

    expect(stored).toMatchObject({ authenticatedAt: proofTime, secondFactor: 'recovery_code' });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(proofTime + 360_000);

    try {
      const stale = await browser.call('POST', '/sessions/revoke-others', {});

      expect(stale.status).toBe(401);
      expect(stale.data).toEqual({ error: 'reauthentication_required' });
    } finally {
      clock.mockRestore();
    }

    // The account remains accessible; the rejected operation does not revoke the session.
    const accessible = await browser.call('GET', '/session');

    expect(accessible.data.authenticated).toBe(true);
  },
);

it.each([false, true])(
  'shares email request cooldown and attempt budget across concurrent replacements (change=%s)',
  async (change) => {
    const browser = await f.client();
    const email = `${randomUUID()}@example.test`;
    const created = await browser.call('POST', '/password/sign-up', { email, password });
    let pendingId = created.data.flowId as string;
    let targetEmail = email;
    const prefix = change ? '/email/change' : '/email';

    if (change) {
      await browser.call('POST', '/email/verify', { flowId: created.data.flowId, code: f.lastCode(email) });

      targetEmail = `${randomUUID()}@example.test`;
      const pending = await browser.call('POST', `${prefix}/request`, { email: targetEmail });

      pendingId = pending.data.flowId;
    }

    const originalId = pendingId;
    const [original] = await f.db.select().from(authSchema.flows).where(eq(authSchema.flows.id, originalId));
    const messages = f.messages.length;
    const blocked = await browser.call('POST', `${prefix}/request`, { email: targetEmail });

    expect(blocked.status).toBe(429);
    expect(blocked.data).toEqual({ error: 'resend_cooldown' });
    expect(f.messages).toHaveLength(messages);
    const unchanged = await f.db.select().from(authSchema.flows).where(eq(authSchema.flows.id, originalId));

    expect(unchanged[0].consumedAt).toBeNull();

    await f.db
      .update(authSchema.flows)
      .set({ attempts: 2, lastSentAt: new Date(Date.now() - 61_000) })
      .where(eq(authSchema.flows.id, originalId));

    const replacements = await Promise.all([
      browser.call('POST', `${prefix}/request`, { email: targetEmail }),
      browser.call('POST', `${prefix}/request`, { email: targetEmail }),
    ]);

    expect(replacements.map((result) => result.status).sort()).toEqual([202, 429]);
    expect(f.messages).toHaveLength(messages + 1);
    const active = await f.db
      .select()
      .from(authSchema.flows)
      .where(
        and(
          eq(authSchema.flows.userId, original.userId!),
          eq(authSchema.flows.purpose, original.purpose),
          isNull(authSchema.flows.consumedAt),
        ),
      );

    expect(active).toHaveLength(1);
    expect(active[0].attempts).toBe(2);
    expect(active[0].expiresAt).toEqual(original.expiresAt);
    const resend = await browser.call('POST', '/challenges/resend', { flowId: active[0].id });

    expect(resend.status).toBe(429);

    await f.db
      .update(authSchema.flows)
      .set({ attempts: 5, lastSentAt: new Date(Date.now() - 61_000) })
      .where(eq(authSchema.flows.id, active[0].id));

    const exhausted = await browser.call('POST', `${prefix}/request`, { email: targetEmail });

    expect(exhausted.status).toBe(400);
    expect(exhausted.data).toEqual({ error: 'verification_failed' });
    expect(f.messages).toHaveLength(messages + 1);
  },
);

it('allows immediate email-request retry after a failed SMTP delivery', async () => {
  const { browser } = await f.signup();
  const email = `${randomUUID()}@example.test`;

  f.failDelivery();
  const failed = await browser.call('POST', '/email/change/request', { email });

  expect(failed.status).toBe(503);
  f.failDelivery(false);
  const retry = await browser.call('POST', '/email/change/request', { email });

  expect(retry.status).toBe(202);
  const verified = await browser.call('POST', '/email/change/verify', {
    flowId: retry.data.flowId,
    code: f.lastCode(email),
  });

  expect(verified.status).toBe(200);
  expect(verified.data.user.email).toBe(email);
});
