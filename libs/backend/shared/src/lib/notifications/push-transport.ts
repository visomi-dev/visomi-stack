import { createECDH } from 'node:crypto';

// Node's ESM loader cannot synthesize web-push's named runtime exports from its CommonJS entry point.
// eslint-disable-next-line import-x/default -- The default import is required by the production gateway loader.
import webPush from 'web-push';
import { z } from 'zod';

import { pushSubscriptionInput } from './push-contract';
import pushCopy from './push-copy.json';

export const vapidConfiguration = z
  .strictObject({
    subject: z
      .url()
      .max(512)
      .refine((value) => {
        const url = new URL(value);

        return (
          (url.protocol === 'mailto:' && z.email().safeParse(url.pathname).success && !url.search && !url.hash) ||
          (url.protocol === 'https:' && !url.username && !url.password)
        );
      }),
    publicKey: z.string().max(100),
    privateKey: z.string().max(100),
  })
  .refine(({ publicKey, privateKey }) => {
    try {
      const key = createECDH('prime256v1');
      const bytes = Buffer.from(privateKey, 'base64url');

      if (bytes.length !== 32 || bytes.toString('base64url') !== privateKey) return false;
      key.setPrivateKey(bytes);

      return key.getPublicKey().toString('base64url') === publicKey;
    } catch {
      return false;
    }
  }, 'Invalid VAPID key pair.');

export type VapidConfiguration = z.infer<typeof vapidConfiguration>;
export type PushDeliveryResult = 'sent' | 'retry' | 'expired' | 'rejected';

/** No caller-controlled payload, navigation, provider body or credentials enter diagnostics. */
export async function deliverPush(
  storedSubscription: unknown,
  configuration: VapidConfiguration,
  signal?: AbortSignal,
  locale: 'en' | 'es' = 'en',
): Promise<PushDeliveryResult> {
  const subscription = pushSubscriptionInput.safeParse(storedSubscription);
  const vapid = vapidConfiguration.safeParse(configuration);

  if (!subscription.success || !vapid.success) return 'rejected';
  try {
    // Angular's service worker requires this notification envelope. Content stays generic.
    // eslint-disable-next-line import-x/no-named-as-default-member -- Declared named types do not describe its CJS runtime.
    const request = webPush.generateRequestDetails(
      subscription.data,
      JSON.stringify({
        notification: {
          ...pushCopy[locale],
          tag: 'visomi-account-update',
          data: { onActionClick: { default: { operation: 'openWindow', url: `/app/${locale}/notifications` } } },
        },
      }),
      { vapidDetails: vapid.data, contentEncoding: 'aes128gcm', TTL: 60, urgency: 'normal' },
    );
    const response = await fetch(subscription.data.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: new Uint8Array(request.body),
      redirect: 'manual',
      signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
    });

    // Discard rather than buffer an untrusted, potentially unbounded vendor response.
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 200 && response.status < 300) return 'sent';
    if (response.status === 404 || response.status === 410) return 'expired';
    if (response.status === 429 || response.status >= 500) return 'retry';

    // Includes every redirect: never forward VAPID credentials to Location.
    return 'rejected';
  } catch {
    return 'retry';
  }
}
