import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Settings } from '../settings';

import type { ResponseEnvelope } from './auth.models';

export type ProfilePreferences = { locale: 'en' | 'es'; theme: 'system' | 'light' | 'dark' };
export type ProfileUpdate = { displayName: string; preferences: ProfilePreferences };
export type Profile = ProfileUpdate & {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  preferencesConfigured?: boolean;
};
export type AccountProfileData = {
  profile: Profile;
  memberships: { accountId: string; name: string; role: string; joinedAt: string }[];
  selectedAccountId: string;
  isWorkspaceOwner: boolean;
  ownershipCandidates: { userId: string; displayName: string; email: string }[];
};
export type EmailChangeChallenge = { flowId: string; email: string; expiresAt: string };
export type ProfileExport = {
  schemaVersion: 1;
  scope: 'profile_and_membership_metadata';
  exportedAt: string;
  profile: Profile;
  memberships: AccountProfileData['memberships'];
};

@Service()
export class AccountProfile {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(Settings);
  private synchronizedUser: string | null | undefined;
  private preferencesRevision = 0;

  async synchronizePreferences(userId: string | null, routePath: () => string): Promise<void> {
    if (this.synchronizedUser === userId) return;
    this.synchronizedUser = userId;
    const revision = ++this.preferencesRevision;

    if (!userId) return;
    try {
      const { profile } = await this.load();

      if (revision === this.preferencesRevision && profile.id === userId && profile.preferencesConfigured === true)
        this.settings.applyProfilePreferences(userId, profile.preferences, routePath(), 'login');
    } catch {
      // Preserve the local appearance; retry on the next owning-layout navigation.
      if (revision === this.preferencesRevision) this.synchronizedUser = undefined;
    }
  }

  applyPreferences(profile: Profile, routePath: string): void {
    // A slow login fetch must never overwrite the explicit save that just completed.
    ++this.preferencesRevision;
    this.synchronizedUser = profile.id;
    this.settings.applyProfilePreferences(profile.id, profile.preferences, routePath, 'save');
  }

  async load(): Promise<AccountProfileData> {
    return (await firstValueFrom(this.http.get<ResponseEnvelope<AccountProfileData>>('/api/account/profile'))).data;
  }

  async save(profile: ProfileUpdate): Promise<Profile> {
    return (await firstValueFrom(this.http.patch<ResponseEnvelope<Profile>>('/api/account/profile', profile))).data;
  }

  async requestEmail(email: string, grantId: string): Promise<EmailChangeChallenge> {
    return (
      await firstValueFrom(
        this.http.post<ResponseEnvelope<EmailChangeChallenge>>('/api/account/email/request', { email, grantId }),
      )
    ).data;
  }

  async verifyEmail(
    flowId: string,
    pin: string,
  ): Promise<{ changed: true; signInRequired: true; notification: 'sent' | 'failed' }> {
    return (
      await firstValueFrom(
        this.http.post<ResponseEnvelope<{ changed: true; signInRequired: true; notification: 'sent' | 'failed' }>>(
          '/api/account/email/verify',
          { flowId, pin },
        ),
      )
    ).data;
  }

  async transfer(targetUserId: string, grantId: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/account/workspace/transfer', { targetUserId, grantId }));
  }

  async leave(grantId: string): Promise<{ left: true; signInRequired: true; hasRemainingMemberships: boolean }> {
    return (
      await firstValueFrom(
        this.http.post<ResponseEnvelope<{ left: true; signInRequired: true; hasRemainingMemberships: boolean }>>(
          '/api/account/workspace/leave',
          { grantId },
        ),
      )
    ).data;
  }

  async exportMetadata(): Promise<ProfileExport> {
    return (await firstValueFrom(this.http.get<ResponseEnvelope<ProfileExport>>('/api/account/export'))).data;
  }
}
