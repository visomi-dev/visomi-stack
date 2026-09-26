import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, inject, signal } from '@angular/core';
import { disabled, FormField, FormRoot, email, form, maxLength, pattern, required } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AccountProfile } from '../shared/auth/account-profile';
import type { AccountProfileData, EmailChangeChallenge, ProfileUpdate } from '../shared/auth/account-profile';
import { SecurityAction } from '../shared/auth/security-action';
import { SecurityConfirmation } from '../shared/auth/security-confirmation/security-confirmation';
import { Auth } from '../shared/auth/auth';
import { SIGN_IN_URL } from '../shared/constants/routes';

@Component({
  selector: 'app-account',
  imports: [FormField, FormRoot, RouterLink, SecurityConfirmation],
  providers: [SecurityAction],
  templateUrl: './account.html',
  styleUrl: './account.css',
})
export class Account {
  private readonly api = inject(AccountProfile);
  private readonly action = inject(SecurityAction);
  private readonly auth = inject(Auth);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  protected readonly data = signal(inject(ActivatedRoute).snapshot.data['account'] as AccountProfileData);
  protected readonly selectedWorkspace = computed(() =>
    this.data().memberships.find((membership) => membership.accountId === this.data().selectedAccountId),
  );
  protected readonly busy = signal(false);
  protected readonly interactive = signal(false);
  // Signal Forms attach their native listeners in the browser. Keep SSR controls
  // disabled until that render completes so hydration cannot discard early edits.
  private readonly enableFormsAfterRender = afterNextRender(() => this.interactive.set(true));
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly finished = signal(false);
  protected readonly signInUrl = SIGN_IN_URL;
  protected readonly challenge = signal<EmailChangeChallenge | null>(null);
  protected readonly profileModel = signal<ProfileUpdate>({
    displayName: this.data().profile.displayName,
    preferences: {
      ...this.data().profile.preferences,
      locale:
        this.data().profile.preferencesConfigured === true
          ? this.data().profile.preferences.locale
          : this.document.documentElement.lang.startsWith('es')
            ? 'es'
            : 'en',
    },
  });
  protected readonly profileForm = form(
    this.profileModel,
    (path) => {
      disabled(path, () => !this.interactive());
      maxLength(path.displayName, 100, { message: $localize`:@@accountNameLength:Use 100 characters or fewer.` });
    },
    {
      submission: {
        action: async () => {
          await this.saveProfile();
        },
      },
    },
  );
  protected readonly emailModel = signal({ email: '' });
  protected readonly emailForm = form(
    this.emailModel,
    (path) => {
      disabled(path, () => !this.interactive());
      required(path.email, { message: $localize`:@@accountEmailRequired:Enter your new email address.` });
      email(path.email, { message: $localize`:@@accountEmailInvalid:Enter a valid email address.` });
      maxLength(path.email, 254, { message: $localize`:@@accountEmailLength:Use 254 characters or fewer.` });
    },
    {
      submission: {
        action: async () => {
          await this.requestEmail();
        },
      },
    },
  );
  protected readonly codeModel = signal({ pin: '' });
  protected readonly codeForm = form(
    this.codeModel,
    (path) => {
      disabled(path, () => !this.interactive());
      pattern(path.pin, /^\d{6}$/, {
        message: $localize`:@@accountCodeInvalid:Enter the 6-digit code sent to your new address.`,
      });
      required(path.pin, {
        message: $localize`:@@accountCodeInvalid:Enter the 6-digit code sent to your new address.`,
      });
    },
    {
      submission: {
        action: async () => {
          await this.verifyEmail();
        },
      },
    },
  );
  protected readonly transferModel = signal({ targetUserId: '' });
  protected readonly transferForm = form(
    this.transferModel,
    (path) => {
      disabled(path, () => !this.interactive());
      required(path.targetUserId, {
        message: $localize`:@@accountMemberRequired:Choose an existing workspace member.`,
      });
    },
    {
      submission: {
        action: async () => {
          await this.transferOwnership();
        },
      },
    },
  );

  private async perform(operation: () => Promise<void>): Promise<void> {
    if (!this.interactive() || this.busy() || this.finished()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await operation();
    } catch (error) {
      this.error.set(this.failureMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async saveProfile(): Promise<void> {
    await this.perform(async () => {
      const profile = await this.api.save(this.profileModel());

      this.data.update((data) => ({ ...data, profile }));
      this.profileModel.set({ displayName: profile.displayName, preferences: { ...profile.preferences } });
      this.notice.set($localize`:@@accountProfileSaved:Your profile and preferences were saved.`);
      try {
        this.api.applyPreferences(profile, this.router.url);
      } catch {
        this.notice.set(
          $localize`:@@accountPreferencesApplyFailed:Your profile was saved, but the display preferences could not be applied. Reload this page to try again.`,
        );
      }
    });
  }

  private async requestEmail(): Promise<void> {
    const email = this.emailModel().email;

    await this.perform(async () => {
      await this.action.run(
        {
          authority: 'operation',
          purpose: 'email_change',
          targetId: email,
          summary: $localize`:@@accountEmailConfirm:Confirm your identity to request a new primary email address.`,
        },
        async (grantId) => {
          this.challenge.set(await this.api.requestEmail(email, grantId));
          this.codeModel.set({ pin: '' });
          this.notice.set(
            $localize`:@@accountEmailSent:Check your new email address for a code. Your primary address has not changed yet.`,
          );
        },
      );
    });
  }

  private async verifyEmail(): Promise<void> {
    const challenge = this.challenge();

    if (!challenge) return;
    await this.perform(async () => {
      const result = await this.api.verifyEmail(challenge.flowId, this.codeModel().pin);

      this.challenge.set(null);
      this.codeModel.set({ pin: '' });
      this.finished.set(true);
      this.notice.set(
        result.notification === 'sent'
          ? $localize`:@@accountEmailChanged:Your email was changed and your previous address was notified. Sign in again with your new address.`
          : $localize`:@@accountEmailChangedNoticeFailed:Your email was changed, but the notification to your previous address could not be sent. Sign in again with your new address.`,
      );
      await this.refreshEndedSession();
    });
  }

  private async transferOwnership(): Promise<void> {
    const targetUserId = this.transferModel().targetUserId;

    await this.perform(async () => {
      await this.action.run(
        {
          authority: 'operation',
          purpose: 'workspace_leave',
          targetId: targetUserId,
          summary: $localize`:@@accountTransferConfirm:Confirm the transfer of this workspace to the selected member. You will remain a member until you leave.`,
        },
        async (grantId) => {
          await this.api.transfer(targetUserId, grantId);
          this.data.update((data) => ({ ...data, isWorkspaceOwner: false }));
          this.notice.set(
            $localize`:@@accountTransferred:Ownership was transferred. You can now leave this workspace.`,
          );
        },
      );
    });
  }

  protected async leaveWorkspace(): Promise<void> {
    const workspace = this.selectedWorkspace();

    if (!workspace) return;
    await this.perform(async () => {
      await this.action.run(
        {
          authority: 'operation',
          purpose: 'workspace_leave',
          targetId: workspace.accountId,
          summary: $localize`:@@accountLeaveConfirm:Leave ${workspace.name}:workspace: immediately? Your identity, other memberships, and the shared workspace will be preserved.`,
        },
        async (grantId) => {
          const result = await this.api.leave(grantId);

          this.finished.set(true);
          this.notice.set(
            result.hasRemainingMemberships
              ? $localize`:@@accountLeft:You left this workspace. Sign in again to access your other workspaces.`
              : $localize`:@@accountLeftLast:You left this workspace. Your identity is preserved, but you no longer have workspace access. Ask a workspace owner for an invitation.`,
          );
          await this.refreshEndedSession();
        },
      );
    });
  }

  private async refreshEndedSession(): Promise<void> {
    // The mutation is durable. A refresh failure must not be shown as a mutation failure.
    try {
      await this.auth.ensureSessionLoaded(true);
    } catch {
      /* The sign-in link remains available. */
    }
  }

  protected async exportMetadata(): Promise<void> {
    await this.perform(async () => {
      const data = await this.api.exportMetadata();
      const view = this.document.defaultView;

      if (!view) return;
      const url = view.URL.createObjectURL(
        new view.Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = this.document.createElement('a');

      link.href = url;
      link.download = 'profile-membership-metadata.json';
      link.click();
      view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
      this.notice.set($localize`:@@accountExported:Your profile and membership metadata export is ready.`);
    });
  }

  private failureMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 429) return $localize`:@@accountRateLimited:Too many attempts. Wait before trying again.`;
      switch (error.error?.code) {
        case 'ownership_transfer_required':
          return $localize`:@@accountOwnerBlocked:Transfer ownership to another workspace member before leaving.`;
        case 'ownership_target_invalid':
          return $localize`:@@accountMemberInvalid:Choose another existing member of this workspace.`;
        case 'email_unavailable':
          return $localize`:@@accountEmailUnavailable:This email address is unavailable. Choose another address.`;
        case 'email_unchanged':
          return $localize`:@@accountEmailUnchanged:Enter a different email address.`;
        case 'invalid_verification_code':
          return $localize`:@@accountCodeMismatch:That code is not valid. Check the message sent to your new address.`;
        case 'email_verification_unavailable':
          return $localize`:@@accountCodeExpired:This verification is no longer available. Request a new code.`;
        case 'email_delivery_failed':
          return $localize`:@@accountDeliveryFailed:The code could not be sent. Your primary email has not changed.`;
      }
      if (error.status === 401)
        return $localize`:@@accountSignInRequired:Your session changed. Sign in again before continuing.`;
    }

    return $localize`:@@accountRequestFailed:The request could not be completed. Check the current state before trying again.`;
  }
}
