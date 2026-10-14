import {
  claimPushDelivery,
  createSessionStore,
  env,
  expirePushDeliveries,
  getPool,
  isSessionAuthorityStore,
  processPushDelivery,
  revokeSessionPushSubscriptions,
  vapidConfiguration,
} from 'shared';

/** Opt-in transport; public subscription registration stays gated separately. */
export async function processNextPush(): Promise<boolean> {
  await expirePushDeliveries();
  if (!env.WEB_PUSH_ENABLED) return false;
  const configuration = vapidConfiguration.safeParse({
    subject: env.WEB_PUSH_SUBJECT,
    publicKey: env.WEB_PUSH_PUBLIC_KEY,
    privateKey: env.WEB_PUSH_PRIVATE_KEY,
  });

  if (!configuration.success) throw new Error('Web Push configuration is invalid.');
  const store = createSessionStore(
    {
      cookieSecure: env.COOKIE_SECURE,
      databaseDriver: env.DATABASE_DRIVER,
      sessionMaxAgeMs: env.SESSION_MAX_AGE_MS,
      sessionSecret: env.SESSION_SECRET,
      onSessionRevoked: revokeSessionPushSubscriptions,
    },
    env.DATABASE_DRIVER === 'pg' ? getPool() : undefined,
  );

  try {
    if (!isSessionAuthorityStore(store)) throw new Error('Push authority is unavailable.');
    const delivery = await claimPushDelivery();

    if (!delivery) return false;
    await processPushDelivery(delivery, store, configuration.data);

    return true;
  } finally {
    if ('close' in store && typeof store.close === 'function') await store.close();
  }
}
