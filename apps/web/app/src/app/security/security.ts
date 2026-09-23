import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, maxLength, required, minLength, pattern } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';

import { Auth } from '../shared/auth/auth';
import { Passkey, type PasskeyCredential } from '../shared/auth/passkey';
import { SecurityAuth } from '../shared/auth/security-auth';
import type { SecurityOverview } from '../shared/auth/security-auth';
import type { PasswordSignInPending } from '../shared/auth/password';
import { SecurityAction } from '../shared/auth/security-action';
import { SecurityConfirmation } from '../shared/auth/security-confirmation/security-confirmation';
import { Form } from '../shared/ui/forms/form/form';
import { Field } from '../shared/ui/forms/field/field';
import { Label } from '../shared/ui/forms/label/label';
import { Input } from '../shared/ui/forms/input/input';
import { PasswordInput } from '../shared/ui/forms/password-input/password-input';
import { GOOGLE_LINK_PATH, PASSWORD_MANAGEMENT_PATH, RECOVERY_CODES_PATH } from '../shared/constants/routes';

type View = 'list' | 'add' | 'name' | 'revoke';

@Component({
  imports: [DatePipe, RouterLink, Form, Field, Label, Input, PasswordInput, SecurityConfirmation],
  providers: [SecurityAction],
  selector: 'app-security',
  templateUrl: './security.html',
  styleUrl: './security.css',
})
export class Security {
  private readonly passkey = inject(Passkey);
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  private readonly security = inject(SecurityAuth);
  private readonly action = inject(SecurityAction);
  protected readonly passwordUrl = `/${PASSWORD_MANAGEMENT_PATH}`;
  protected readonly recoveryUrl = `/${RECOVERY_CODES_PATH}`;
  protected readonly googleUrl = `/${GOOGLE_LINK_PATH}`;
  readonly overviewLoading = signal(true);
  readonly overviewError = signal('');
  readonly mutationBusy = signal(false);
  readonly notice = signal('');
  readonly firstPasskeyFlow = signal<PasswordSignInPending | null>(null);
  readonly enrollmentAuthorized = signal(false);
  readonly identityEnrollmentAvailable = computed(() =>
    Boolean(
      !this.credentials().length &&
      this.overview()?.googleLinkEnabled &&
      this.overview()?.federatedIdentities.some((identity) => identity.provider === 'google'),
    ),
  );
  readonly enrollmentBusy = signal(false);
  readonly enrollmentModel = signal({ password: '', code: '' });
  readonly enrollmentForm = form(this.enrollmentModel, (path) => {
    required(path.password, { when: () => !this.firstPasskeyFlow() });
    required(path.code, { when: () => !!this.firstPasskeyFlow() });
    minLength(path.code, 6, { when: () => !!this.firstPasskeyFlow() });
    maxLength(path.code, 6);
    pattern(path.code, /^\d*$/);
  });
  readonly pendingRemoval = signal<{ kind: 'federated' | 'device'; id: string } | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly credentials = signal<PasskeyCredential[]>([]);
  readonly view = signal<View>('list');
  readonly selected = signal<PasskeyCredential | null>(null);
  readonly nameModel = signal({ name: '' });
  readonly nameForm = form(this.nameModel, (path) => {
    required(path.name);
    maxLength(path.name, 64);
  });
  readonly passkeyName = computed(() => this.nameModel().name);
  readonly passkeyLoading = signal(true);
  readonly passkeySubmitting = signal(false);
  protected readonly addSubmitLabel = computed(() =>
    this.passkeySubmitting()
      ? $localize`:@@securityWaitingConfirmation:Waiting for confirmation...`
      : $localize`:@@securityConfirmAdd:Confirm and add passkey`,
  );
  protected readonly revokeSubmitLabel = computed(() =>
    this.passkeySubmitting()
      ? $localize`:@@securityConfirming:Confirming...`
      : $localize`:@@securityConfirmRevoke:Confirm passkey and revoke`,
  );
  readonly passkeyError = signal('');
  readonly overview = signal<SecurityOverview | null>(null);

  constructor() {
    void this.loadCredentials();
    void this.loadOverview();
  }

  async revokeFederatedIdentity(id: string): Promise<void> {
    await this.runOverviewMutation(`/api/auth/security/federated/${encodeURIComponent(id)}`, id);
  }

  async revokeTrustedDevice(id: string): Promise<void> {
    await this.runOverviewMutation(`/api/auth/security/devices/${encodeURIComponent(id)}`);
  }

  protected requestRemoval(kind: 'federated' | 'device', id: string): void {
    this.pendingRemoval.set({ kind, id });
  }

  protected async confirmRemoval(): Promise<void> {
    const selected = this.pendingRemoval();

    if (!selected || this.mutationBusy()) return;
    if (selected.kind === 'federated') await this.revokeFederatedIdentity(selected.id);
    else await this.revokeTrustedDevice(selected.id);
    this.pendingRemoval.set(null);
  }

  private async runOverviewMutation(url: string, identityId?: string): Promise<void> {
    if (this.mutationBusy()) return;
    this.mutationBusy.set(true);
    this.overviewError.set('');
    this.notice.set('');
    try {
      const remove = async (grantId?: string) => {
        await firstValueFrom(this.http.delete(url, { body: grantId ? { grantId } : undefined }));
        await this.loadOverview();
        this.notice.set($localize`:@@securityAccessRemoved:Access through this method has been removed.`);
      };

      if (identityId) {
        await this.action.run(
          {
            authority: 'operation',
            purpose: 'google_unlink',
            targetId: identityId,
            summary: $localize`:@@securityGoogleUnlinkConfirm:Confirm your identity to remove Google sign-in.`,
          },
          remove,
        );
      } else await remove();
    } catch (error) {
      this.overviewError.set(
        error instanceof HttpErrorResponse && error.error?.code === 'last_access_method'
          ? $localize`:@@securityKeepAccessMethod:Set up and verify another sign-in method before removing this one.`
          : $localize`:@@securityUpdateFailed:We could not update this access method. Check its current status before trying again.`,
      );
    } finally {
      this.mutationBusy.set(false);
    }
  }

  protected recoveryEvent(event: string): string {
    if (event === 'recovery_codes_regenerated') return $localize`:@@securityCodesReplaced:Recovery codes replaced`;
    if (event === 'recovery_started') return $localize`:@@securityRecoveryStarted:Account recovery started`;

    return $localize`:@@securityRecoveryActivity:Account recovery activity`;
  }

  protected methodStatus(enabled: boolean): string {
    return enabled ? $localize`:@@securityEnabled:Enabled` : $localize`:@@securityNotConfigured:Not set up`;
  }

  async loadCredentials() {
    this.passkeyLoading.set(true);
    this.passkeyError.set('');
    try {
      this.credentials.set(await this.passkey.listCredentials());
    } catch {
      this.passkeyError.set($localize`:@@securityPasskeysLoadFailed:Passkeys could not be loaded.`);
    } finally {
      this.passkeyLoading.set(false);
      this.loading.set(false);
    }
  }

  async loadOverview(): Promise<void> {
    this.overviewLoading.set(true);
    this.overviewError.set('');
    try {
      this.overview.set(await this.security.overview());
    } catch {
      this.overviewError.set(
        $localize`:@@securityOverviewUnavailable:We could not load your account overview. Your passkeys are still available.`,
      );
    } finally {
      this.overviewLoading.set(false);
    }
  }

  showAdd() {
    this.firstPasskeyFlow.set(null);
    this.enrollmentAuthorized.set(false);
    this.enrollmentModel.set({ password: '', code: '' });
    this.passkeyError.set('');
    this.nameModel.set({ name: '' });
    this.view.set('add');
  }

  showRename(credential: PasskeyCredential) {
    this.passkeyError.set('');
    this.selected.set(credential);
    this.nameModel.set({ name: credential.label });
    this.view.set('name');
  }

  showRevoke(credential: PasskeyCredential) {
    this.passkeyError.set('');
    this.selected.set(credential);
    this.view.set('revoke');
  }

  cancelPasskeyAction() {
    this.enrollmentAuthorized.set(false);
    this.firstPasskeyFlow.set(null);
    this.enrollmentModel.set({ password: '', code: '' });
    this.selected.set(null);
    this.view.set('list');
  }

  async addPasskey() {
    const name = this.passkeyName().trim();

    if (!name || this.passkeySubmitting() || (!this.credentials().length && !this.enrollmentAuthorized())) return;
    await this.runPasskeyMutation(
      'passkey_add',
      $localize`:@@securityAddAction:Confirm your passkey to add a new sign-in method.`,
      async () => {
        const user = await this.currentUser();

        if (!user) throw new Error('Sign in again before adding a passkey.');
        const registration = await this.passkey.beginRegistration(name);
        const credential = await this.passkey.createCredential(registration.options!);
        const completed = await this.passkey.completeRegistration(registration.challengeId!, credential);
        const verification = completed.restrictedSession;

        if (!verification?.verificationChallengeId || !verification.verificationOptions) {
          throw new Error('Passkey verification options were not returned.');
        }
        const assertion = await this.passkey.getCredential(verification.verificationOptions);

        await this.passkey.verifyRegistration(verification.verificationChallengeId, assertion);
        await this.loadCredentials();
        this.cancelPasskeyAction();
      },
    );
  }

  async renamePasskey() {
    const selected = this.selected();
    const name = this.passkeyName().trim();

    if (!selected || !name || this.passkeySubmitting()) return;
    await this.runPasskeyMutation(
      'passkey_rename',
      $localize`:@@securityRenameAction:Confirm your passkey to rename this sign-in method.`,
      async () => {
        const updated = await this.passkey.renameCredential(selected.id, name);

        this.credentials.update((items) => items.map((item) => (item.id === updated.id ? updated : item)));
        this.cancelPasskeyAction();
      },
    );
  }

  async revokePasskey() {
    const selected = this.selected();

    if (!selected || this.passkeySubmitting()) return;
    await this.runPasskeyMutation(
      'passkey_revoke',
      $localize`:@@securityRevokeAction:Confirm your passkey to remove this sign-in method.`,
      async () => {
        await this.passkey.revokeCredential(selected.id);
        this.credentials.update((items) => items.filter((item) => item.id !== selected.id));
        this.cancelPasskeyAction();
      },
    );
  }

  private async currentUser() {
    await this.auth.ensureSessionLoaded();

    return this.auth.user();
  }

  private async runPasskeyMutation(
    purpose: 'passkey_add' | 'passkey_rename' | 'passkey_revoke',
    summary: string,
    mutation: () => Promise<void>,
  ) {
    this.passkeySubmitting.set(true);
    this.passkeyError.set('');
    try {
      if (purpose === 'passkey_add' && this.enrollmentAuthorized()) {
        await mutation();
      } else
        await this.action.run(
          {
            authority: 'passkey',
            purpose,
            targetId: this.selected()?.id ?? 'new-passkey',
            summary: `${summary} ${this.selected()?.label ?? this.passkeyName()}`,
          },
          mutation,
        );
    } catch (error) {
      this.passkeyError.set(
        error instanceof HttpErrorResponse && error.error?.code === 'last_access_method'
          ? $localize`:@@securityKeepAccessMethod:Set up and verify another sign-in method before removing this one.`
          : $localize`:@@securityPasskeyActionFailed:We could not complete this passkey action. Check its current status before trying again.`,
      );
    } finally {
      this.passkeySubmitting.set(false);
    }
  }

  protected async authorizeFirstPasskey(): Promise<void> {
    if (this.enrollmentBusy() || this.enrollmentForm().invalid()) return;
    this.enrollmentBusy.set(true);
    this.passkeyError.set('');
    try {
      const flow = this.firstPasskeyFlow();
      const { password, code } = this.enrollmentModel();

      if (!flow) this.firstPasskeyFlow.set(await this.security.startFirstPasskey(password));
      else {
        await this.security.completeFirstPasskey(flow.flowId, code, flow.requiredFactor);
        this.enrollmentAuthorized.set(true);
      }
    } catch {
      this.passkeyError.set(
        $localize`:@@securityFirstPasskeyFailed:We could not confirm this enrollment. Check your password or verification code and try again.`,
      );
    } finally {
      this.enrollmentModel.set({ password: '', code: '' });
      this.enrollmentBusy.set(false);
    }
  }

  protected restartFirstPasskey(): void {
    if (this.enrollmentBusy() || this.passkeySubmitting()) return;
    this.firstPasskeyFlow.set(null);
    this.enrollmentAuthorized.set(false);
    this.enrollmentModel.set({ password: '', code: '' });
    this.passkeyError.set('');
  }

  protected async authorizeFirstPasskeyIdentity(): Promise<void> {
    if (this.enrollmentBusy() || !this.identityEnrollmentAvailable()) return;
    this.enrollmentBusy.set(true);
    this.passkeyError.set('');
    try {
      await this.action.run(
        {
          authority: 'operation',
          purpose: 'passkey_enroll',
          targetId: 'new-passkey',
          summary: $localize`:@@securityFirstPasskeyIdentity:Confirm your connected identity before creating your first passkey.`,
        },
        async (grantId) => {
          await this.security.authorizeIdentityEnrollment(grantId);
          this.enrollmentAuthorized.set(true);
        },
      );
    } catch {
      this.passkeyError.set(
        $localize`:@@securityPasskeyActionFailed:We could not complete this passkey action. Check its current status before trying again.`,
      );
    } finally {
      this.enrollmentBusy.set(false);
    }
  }
}
