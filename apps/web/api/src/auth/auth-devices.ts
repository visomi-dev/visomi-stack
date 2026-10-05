import { randomUUID } from 'node:crypto';

import { and, eq, gt } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { env } from '../shared/env';

import { generateUserDeviceToken, hashUserDeviceToken, verifyUserDeviceToken } from './auth-crypto';

import { db, safeInsert, userDevices } from 'shared';

export async function createUserDevice(userId: string) {
  const token = generateUserDeviceToken();
  const now = DateTime.utc();

  await safeInsert(
    () =>
      db.insert(userDevices).values({
        createdAt: now.toJSDate(),
        expiresAt: now.plus({ milliseconds: env.REMEMBERED_DEVICE_MAX_AGE_MS }).toJSDate(),
        id: randomUUID(),
        tokenHash: hashUserDeviceToken(token),
        updatedAt: now.toJSDate(),
        userId,
      }),
    'user_devices_token_hash_idx',
    {
      code: 'device_token_collision',
      message: 'A device with that token already exists.',
      statusCode: 409,
    },
  );

  return token;
}

export async function isRememberedDevice(userId: string, token: string | undefined) {
  if (!token) {
    return false;
  }
  const devices = await db
    .select()
    .from(userDevices)
    .where(and(eq(userDevices.userId, userId), gt(userDevices.expiresAt, DateTime.utc().toJSDate())));

  for (const device of devices) {
    if (verifyUserDeviceToken(token, device.tokenHash)) {
      await db
        .update(userDevices)
        .set({ lastUsedAt: DateTime.utc().toJSDate(), updatedAt: DateTime.utc().toJSDate() })
        .where(eq(userDevices.id, device.id));

      return true;
    }
  }

  return false;
}
