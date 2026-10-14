import { env } from '../env';

import { vapidConfiguration } from './push-transport';

/** Public capabilities must never expose the private VAPID key or its validation errors. */
export function readPushConfiguration() {
  if (!env.WEB_PUSH_ENABLED) return null;
  const result = vapidConfiguration.safeParse({
    subject: env.WEB_PUSH_SUBJECT,
    publicKey: env.WEB_PUSH_PUBLIC_KEY,
    privateKey: env.WEB_PUSH_PRIVATE_KEY,
  });

  return result.success ? result.data : null;
}
