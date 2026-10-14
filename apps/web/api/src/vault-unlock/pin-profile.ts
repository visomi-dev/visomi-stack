import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { withAccountContext, accountMemberships, users, vaultPinProfiles, HttpError } from 'shared';
import { vaultPinProfile } from 'shared-crypto';
import type { VaultPinProfile } from 'shared-crypto';

export type UnlockOwner = { userId: string; accountId: string; authVersion: number };
type Transaction = Parameters<Parameters<typeof withAccountContext>[1]>[0];
const windowMs = 10 * 60_000;

function fail(code: string, message: string, statusCode: number): never {
  throw new HttpError({ code, message, statusCode });
}

export async function lockUnlockScope(tx: Transaction, owner: UnlockOwner, scopeId: string): Promise<void> {
  if (scopeId !== owner.accountId) fail('vault_access_denied', 'This vault is unavailable.', 403);
  const [user] = await tx
    .select({ authVersion: users.authVersion })
    .from(users)
    .where(eq(users.id, owner.userId))
    .for('share');
  const [member] = await tx
    .select({ id: accountMemberships.id })
    .from(accountMemberships)
    .where(and(eq(accountMemberships.accountId, scopeId), eq(accountMemberships.userId, owner.userId)))
    .for('update');

  if (!member || user?.authVersion !== owner.authVersion)
    fail('vault_access_denied', 'Sign in again to open your vault.', 403);
}

function owned(owner: UnlockOwner) {
  return and(eq(vaultPinProfiles.accountId, owner.accountId), eq(vaultPinProfiles.userId, owner.userId));
}

export async function readPinProfile(owner: UnlockOwner, scopeId: string): Promise<VaultPinProfile | null> {
  return withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    const [record] = await tx.select().from(vaultPinProfiles).where(owned(owner));

    return record?.profile ? vaultPinProfile.parse(record.profile) : null;
  });
}

export async function readPinMethodId(owner: UnlockOwner, scopeId: string): Promise<string | null> {
  return withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    const [record] = await tx.select().from(vaultPinProfiles).where(owned(owner));

    return record?.active ? (record.profile?.binding.methodId ?? null) : null;
  });
}

export async function authorizePinProfile(
  owner: UnlockOwner,
  scopeId: string,
  expectedMethodId: string | null,
  input?: VaultPinProfile,
): Promise<void> {
  const profile = input ? vaultPinProfile.parse(input) : undefined;

  await withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    const [record] = await tx.select().from(vaultPinProfiles).where(owned(owner));
    const current = record?.profile;

    if ((current?.binding.methodId ?? null) !== expectedMethodId) {
      fail('vault_pin_changed', 'Your vault PIN changed. Open your vault and try again.', 409);
    }
    if (!profile && (!current || !record?.active))
      fail('vault_pin_profile_required', 'Set up your vault PIN first.', 400);
    if (!profile) return;
    if (profile.binding.ownerUserId !== owner.userId || profile.binding.personalScopeId !== scopeId) {
      fail('vault_binding_mismatch', 'The vault setup did not match. Try again.', 400);
    }
    if (profile.binding.methodId === expectedMethodId)
      fail('vault_pin_profile_conflict', 'Choose a new PIN setup.', 409);
    // Only a purpose-bound reauthenticated replacement may reset the online attempt budget.
    await tx
      .insert(vaultPinProfiles)
      .values({
        id: randomUUID(),
        accountId: scopeId,
        userId: owner.userId,
        profile,
        attempts: 0,
        windowStartedAt: DateTime.utc().toJSDate(),
      })
      .onConflictDoUpdate({
        target: [vaultPinProfiles.accountId, vaultPinProfiles.userId],
        set: { profile, active: true, attempts: 0, windowStartedAt: DateTime.utc().toJSDate() },
      });
  });
}

/** The server cannot verify local PIN success, so clients cannot reset this shared budget. */
export async function consumePinAttempt(owner: UnlockOwner, scopeId: string, methodId: string) {
  return withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    const [record] = await tx.select().from(vaultPinProfiles).where(owned(owner)).for('update');

    if (!record?.active || !record.profile || record.profile.binding.methodId !== methodId) {
      fail('vault_pin_changed', 'Your vault PIN changed. Use another unlock method.', 409);
    }
    const now = DateTime.utc();
    const expiry = DateTime.fromJSDate(record.windowStartedAt, { zone: 'utc' }).plus({ milliseconds: windowMs });
    const elapsed = expiry.toMillis() <= now.toMillis();
    const attempts = elapsed ? 0 : record.attempts;

    if (attempts >= 5) fail('vault_pin_cooldown', 'Wait before trying your vault PIN again.', 429);
    await tx
      .update(vaultPinProfiles)
      .set({ attempts: attempts + 1, ...(elapsed ? { windowStartedAt: now.toJSDate() } : {}) })
      .where(owned(owner));

    return { remaining: 4 - attempts, resetsAt: (elapsed ? now.plus({ milliseconds: windowMs }) : expiry).toISO()! };
  });
}

export async function revokePinProfile(owner: UnlockOwner, scopeId: string, methodId: string): Promise<void> {
  await withAccountContext(owner, async (tx) => {
    await lockUnlockScope(tx, owner, scopeId);
    const [record] = await tx.select().from(vaultPinProfiles).where(owned(owner));

    if (!record?.profile) return;
    if (record.profile.binding.methodId !== methodId)
      fail('vault_pin_changed', 'The vault PIN changed. Try again.', 409);
    // Retain the DEK-encrypted continuity anchor: revocation must not allow accidental key replacement.
    await tx.update(vaultPinProfiles).set({ active: false }).where(owned(owner));
  });
}
