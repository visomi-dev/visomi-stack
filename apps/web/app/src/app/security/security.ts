import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Auth } from '../shared/auth/auth';
import { Passkey, type PasskeyCredential } from '../shared/auth/passkey';
import { DeviceApproval } from '../shared/auth/device-approval';

type View = 'list' | 'add' | 'name' | 'revoke';
type SecurityOverview = {
  federatedIdentities: Array<{ id: string; provider: string; emailAtLink: string; linkedAt: string }>;
  trustedDevices: Array<{ id: string; createdAt: string; lastUsedAt: string | null; expiresAt: string }>;
  recoveryEvents: Array<{ event: string; outcome: string; createdAt: string }>;
};

@Component({
  imports: [DatePipe],
  selector: 'app-security',
  templateUrl: './security.html',
  styleUrl: './security.css',
})
export class Security {
  private readonly passkey = inject(Passkey);
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  private readonly approval = inject(DeviceApproval);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly credentials = signal<PasskeyCredential[]>([]);
  readonly view = signal<View>('list');
  readonly selected = signal<PasskeyCredential | null>(null);
  readonly passkeyName = signal('');
  readonly passkeyLoading = signal(true);
  readonly passkeySubmitting = signal(false);
  readonly passkeyError = signal('');
  readonly overview = signal<SecurityOverview | null>(null);
  readonly approvalRequest = signal<{ requestId: string; userCode: string; expiresAt: string } | null>(null);
  readonly approvalStatus = signal('');

  constructor() {
    void this.loadCredentials();
    void this.loadOverview();
  }

  async revokeFederatedIdentity(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/auth/security/federated/${encodeURIComponent(id)}`));
    await this.loadOverview();
  }

  async revokeTrustedDevice(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/auth/security/devices/${encodeURIComponent(id)}`));
    await this.loadOverview();
  }

  async requestDeviceApproval(): Promise<void> {
    const user = await this.currentUser();

    if (!user) return;
    const request = await this.approval.request(user.accountId);

    this.approvalRequest.set({
      requestId: request.requestId,
      userCode: request.userCode ?? '',
      expiresAt: request.expiresAt,
    });
    this.approvalStatus.set('Waiting for approval from another trusted device.');
    void this.pollApproval(request.requestId);
  }

  async approveDevice(requestId: string): Promise<void> {
    await this.reauthenticateWithPasskey();
    await this.approval.approve(requestId);
    this.approvalStatus.set('Device approved.');
  }

  private async pollApproval(requestId: string): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const status = await this.approval.poll(requestId);

      if (status.status === 'approved') {
        this.approvalStatus.set('Device approved. Enter the code on the new device.');

        return;
      }
      if (status.status === 'denied' || status.status === 'consumed') return;
    }
    this.approvalStatus.set('The approval request expired.');
  }

  private async loadCredentials() {
    try {
      this.credentials.set(await this.passkey.listCredentials());
    } catch {
      this.passkeyError.set('Passkeys could not be loaded.');
    } finally {
      this.passkeyLoading.set(false);
      this.loading.set(false);
    }
  }

  private async loadOverview(): Promise<void> {
    try {
      const response = await firstValueFrom(this.http.get<{ data: SecurityOverview }>('/api/auth/security/overview'));

      this.overview.set(response.data);
    } catch {
      this.overview.set(null);
    }
  }

  showAdd() {
    this.passkeyError.set('');
    this.passkeyName.set('');
    this.view.set('add');
  }

  showRename(credential: PasskeyCredential) {
    this.passkeyError.set('');
    this.selected.set(credential);
    this.passkeyName.set(credential.label);
    this.view.set('name');
  }

  showRevoke(credential: PasskeyCredential) {
    this.passkeyError.set('');
    this.selected.set(credential);
    this.view.set('revoke');
  }

  cancelPasskeyAction() {
    this.selected.set(null);
    this.view.set('list');
  }

  setPasskeyName(event: Event) {
    const input = event.target;

    if (input instanceof HTMLInputElement) this.passkeyName.set(input.value);
  }

  async addPasskey() {
    const name = this.passkeyName().trim();

    if (!name || this.passkeySubmitting()) return;
    await this.runPasskeyMutation(async () => {
      const user = await this.currentUser();

      if (!user) throw new Error('Sign in again before adding a passkey.');
      await this.reauthenticateWithPasskey();
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
    });
  }

  async renamePasskey() {
    const selected = this.selected();
    const name = this.passkeyName().trim();

    if (!selected || !name || this.passkeySubmitting()) return;
    await this.runPasskeyMutation(async () => {
      await this.reauthenticateWithPasskey();
      const updated = await this.passkey.renameCredential(selected.id, name);

      this.credentials.update((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      this.cancelPasskeyAction();
    });
  }

  async revokePasskey() {
    const selected = this.selected();

    if (!selected || this.passkeySubmitting()) return;
    await this.runPasskeyMutation(async () => {
      await this.reauthenticateWithPasskey();
      await this.passkey.revokeCredential(selected.id);
      this.credentials.update((items) => items.filter((item) => item.id !== selected.id));
      this.cancelPasskeyAction();
    });
  }

  private async reauthenticateWithPasskey() {
    const user = await this.currentUser();

    if (!user) throw new Error('Sign in again before changing passkeys.');
    const authentication = await this.passkey.beginAuthentication();
    const credential = await this.passkey.getCredential(authentication.options!);

    await this.passkey.completeAuthentication(authentication.challengeId!, credential);
  }

  private async currentUser() {
    await this.auth.ensureSessionLoaded();

    return this.auth.user();
  }

  private async runPasskeyMutation(mutation: () => Promise<void>) {
    this.passkeySubmitting.set(true);
    this.passkeyError.set('');
    try {
      await mutation();
    } catch (error) {
      this.passkeyError.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? 'Passkey action failed.')
          : 'Passkey action failed.',
      );
    } finally {
      this.passkeySubmitting.set(false);
    }
  }
}
