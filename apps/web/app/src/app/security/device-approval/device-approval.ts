import { DatePipe, DOCUMENT, Location } from '@angular/common';
import { afterNextRender, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, maxLength, required } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { DeviceApproval } from '../../shared/auth/device-approval';
import type { ApprovalStatus, DeviceApprovalReview } from '../../shared/auth/device-approval';
import { Passkey } from '../../shared/auth/passkey';
import { SecurityAction } from '../../shared/auth/security-action';
import { SecurityConfirmation } from '../../shared/auth/security-confirmation/security-confirmation';
import { DEVICE_APPROVAL_URL, SECURITY_URL } from '../../shared/constants/routes';
import { Deps } from '../../shared/deps';
import { Field } from '../../shared/ui/forms/field/field';
import { Form } from '../../shared/ui/forms/form/form';
import { Input } from '../../shared/ui/forms/input/input';
import { Label } from '../../shared/ui/forms/label/label';

@Component({
  selector: 'app-device-approval',
  imports: [DatePipe, RouterLink, Field, Form, Input, Label, SecurityConfirmation],
  providers: [SecurityAction],
  templateUrl: './device-approval.html',
  styleUrl: './device-approval.css',
})
export class DeviceApprovalPage {
  private readonly approval = inject(DeviceApproval);
  private readonly auth = inject(Auth);
  private readonly action = inject(SecurityAction);
  private readonly passkey = inject(Passkey);
  private readonly deps = inject(Deps);
  private readonly document = inject(DOCUMENT);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private activeId = '';
  private userCode = '';
  private timer?: number;
  private expiryTimer?: number;
  private generation = 0;
  private disposed = false;
  private polling = false;
  private verification?: { id: string; options: Record<string, unknown> };
  private controller?: AbortController;
  protected readonly securityUrl = SECURITY_URL;
  readonly record = signal<DeviceApprovalReview | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly link = signal('');
  readonly qr = signal('');
  readonly lostCode = signal(false);
  readonly stage = signal<'request' | 'enroll' | 'verify' | 'done'>('request');
  readonly nameModel = signal({ name: '' });
  readonly nameForm = form(this.nameModel, (path) => {
    required(path.name);
    maxLength(path.name, 64);
  });

  constructor() {
    afterNextRender(() => {
      this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
        const id = params.get('requestId');

        if (id !== this.activeId) void this.load(id);
      });
      const visibility = () => {
        this.stopPolling();
        if (!this.document.hidden) this.schedulePoll();
      };

      this.document.addEventListener('visibilitychange', visibility);
      this.destroyRef.onDestroy(() => this.document.removeEventListener('visibilitychange', visibility));
    });
    this.destroyRef.onDestroy(() => {
      this.disposed = true;
      this.stopPolling();
      if (this.expiryTimer !== undefined) this.document.defaultView?.clearTimeout(this.expiryTimer);
      this.controller?.abort();
      this.userCode = '';
      this.verification = undefined;
    });
  }

  private async load(id: string | null): Promise<void> {
    this.stopPolling();
    if (this.expiryTimer !== undefined) this.document.defaultView?.clearTimeout(this.expiryTimer);
    this.busy.set(false);
    this.error.set('');
    this.activeId = id ?? '';
    this.userCode = '';
    this.record.set(null);
    this.link.set('');
    this.qr.set('');
    this.lostCode.set(false);
    this.stage.set('request');
    if (!id) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      this.error.set(
        $localize`:@@approvalUnavailable:This request is not available. Return to Security and start again.`,
      );

      return;
    }
    this.busy.set(true);
    try {
      const reviewed = await this.approval.review(id);

      if (this.disposed || this.activeId !== id) return;
      this.record.set(reviewed);
      this.scheduleExpiration();
      this.lostCode.set(reviewed.requester && ['pending', 'approved'].includes(reviewed.status));
    } catch {
      if (this.disposed || this.activeId !== id) return;
      this.error.set(
        $localize`:@@approvalUnavailable:This request is not available. Return to Security and start again.`,
      );
    } finally {
      if (!this.disposed && this.activeId === id) this.busy.set(false);
    }
  }

  protected async start(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.stopPolling();
    this.error.set('');
    try {
      const previous = this.record();

      if (previous?.requester && ['pending', 'approved'].includes(previous.status))
        await this.approval.cancel(previous.requestId);
      const user = this.auth.user();

      if (!user) return;
      const request = await this.approval.request(user.accountId);

      if (this.disposed) return;
      this.activeId = request.requestId;
      this.userCode = request.userCode;
      this.lostCode.set(false);
      this.record.set({
        requestId: request.requestId,
        expiresAt: request.expiresAt,
        status: 'pending',
        accountId: user.accountId,
        createdAt: new Date().toISOString(),
        requester: true,
      });
      await this.router.navigate([DEVICE_APPROVAL_URL], {
        queryParams: { requestId: request.requestId },
        replaceUrl: true,
      });
      const path = this.location.prepareExternalUrl(
        this.router.serializeUrl(
          this.router.createUrlTree([DEVICE_APPROVAL_URL], { queryParams: { requestId: request.requestId } }),
        ),
      );
      const link = new URL(path, this.document.baseURI).href;

      this.link.set(link);
      this.scheduleExpiration();
      this.schedulePoll();
      try {
        const qr = await this.deps.approvalQr(link);

        if (!this.disposed && this.activeId === request.requestId) this.qr.set(qr);
      } catch {
        this.notice.set($localize`:@@approvalQrUnavailable:The QR code is unavailable. Use the link instead.`);
      }
    } catch {
      this.error.set(
        $localize`:@@approvalStartFailed:We could not start this request. Check its current status before trying again.`,
      );
    } finally {
      this.busy.set(false);
    }
  }

  private stopPolling(): void {
    this.generation += 1;
    if (this.timer !== undefined) this.document.defaultView?.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private scheduleExpiration(): void {
    const window = this.document.defaultView;
    const record = this.record();

    if (this.expiryTimer !== undefined) window?.clearTimeout(this.expiryTimer);
    if (!window || !record || !['pending', 'approved'].includes(record.status)) return;
    const remaining = Date.parse(record.expiresAt) - Date.now();

    if (!Number.isFinite(remaining)) return;
    this.expiryTimer = window.setTimeout(
      () => {
        if (
          this.disposed ||
          this.record()?.requestId !== record.requestId ||
          !['pending', 'approved'].includes(this.record()!.status)
        )
          return;
        if (Date.parse(record.expiresAt) > Date.now()) {
          this.scheduleExpiration();

          return;
        }
        this.stopPolling();
        this.userCode = '';
        this.record.update((current) => current && { ...current, status: 'expired' });
      },
      Math.min(2_147_483_647, Math.max(0, remaining)),
    );
  }

  private schedulePoll(delay = 0): void {
    const record = this.record();
    const window = this.document.defaultView;

    if (
      !window ||
      this.disposed ||
      this.document.hidden ||
      !record?.requester ||
      record.status !== 'pending' ||
      !this.userCode ||
      this.polling
    )
      return;
    const generation = this.generation;

    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.poll(record.requestId, generation), delay);
  }

  private async poll(id: string, generation: number): Promise<void> {
    if (this.polling || this.disposed || generation !== this.generation || this.record()?.status !== 'pending') return;
    this.polling = true;
    try {
      const state = await this.approval.poll(id);

      if (this.disposed || generation !== this.generation) return;
      this.record.update((record) => record && { ...record, ...state });
      this.error.set('');
    } catch {
      if (generation !== this.generation || this.disposed) return;
      this.error.set(
        $localize`:@@approvalRefreshFailed:We could not refresh the request. Check your connection; we will try again.`,
      );
    } finally {
      this.polling = false;
      this.schedulePoll(5000);
    }
  }

  protected async cancel(): Promise<void> {
    await this.changeStatus('cancel');
  }
  protected async deny(): Promise<void> {
    await this.changeStatus('deny');
  }

  private async changeStatus(operation: 'cancel' | 'deny'): Promise<void> {
    const record = this.record();

    if (!record || this.busy()) return;
    this.busy.set(true);
    this.stopPolling();
    try {
      const response = await this.approval[operation](record.requestId);

      this.record.set({ ...record, ...response });
      this.userCode = '';
      this.link.set('');
      this.qr.set('');
    } catch {
      this.error.set(
        $localize`:@@approvalActionFailed:The request could not be updated. Reload its status before trying again.`,
      );
      await this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  protected async refresh(): Promise<void> {
    if (!this.activeId) return;
    try {
      this.record.set(await this.approval.review(this.activeId));
    } catch {
      this.error.set(
        $localize`:@@approvalUnavailable:This request is not available. Return to Security and start again.`,
      );
    }
    this.stopPolling();
    this.schedulePoll();
  }

  protected async approve(): Promise<void> {
    const record = this.record();

    if (!record || record.requester || record.status !== 'pending' || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.action.run(
        {
          authority: 'passkey',
          purpose: 'device_approve',
          targetId: record.requestId,
          summary: $localize`:@@securityApproveAction:Confirm your passkey to approve this device setup request.`,
        },
        async () => {
          await this.approval.approve(record.requestId);
          this.record.set({ ...record, status: 'approved' });
        },
      );
    } catch {
      this.error.set(
        $localize`:@@approvalActionFailed:The request could not be updated. Reload its status before trying again.`,
      );
      await this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  protected async continueEnrollment(): Promise<void> {
    const record = this.record();

    if (!record?.requester || record.status !== 'approved' || !this.userCode || this.busy()) return;
    this.busy.set(true);
    this.stopPolling();
    try {
      await this.approval.consume(record.requestId, this.userCode);
      this.userCode = '';
      this.link.set('');
      this.qr.set('');
      this.record.set({ ...record, status: 'consumed' });
      this.stage.set('enroll');
    } catch {
      this.error.set(
        $localize`:@@approvalConsumeFailed:Setup authorization could not be confirmed. Check the request status before starting again.`,
      );
      await this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  protected async createPasskey(): Promise<void> {
    if (this.busy() || this.nameForm().invalid()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const begin = await this.passkey.beginRegistration(this.nameModel().name.trim());

      if (!begin.options || !begin.challengeId || this.disposed) return;
      const credential = await this.passkey.createCredential(begin.options);

      if (this.disposed) return;
      const result = await this.passkey.completeRegistration(begin.challengeId, credential);
      const verification = result.restrictedSession;

      if (!verification?.verificationChallengeId || !verification.verificationOptions)
        throw new Error('Missing verification');
      this.verification = { id: verification.verificationChallengeId, options: verification.verificationOptions };
      this.stage.set('verify');
    } catch {
      this.error.set(
        $localize`:@@approvalEnrollmentFailed:Passkey setup was not completed. Retry or start a new approval request if authorization expired.`,
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async verifyPasskey(): Promise<void> {
    if (this.busy() || !this.verification) return;
    this.busy.set(true);
    this.controller = new AbortController();
    try {
      const credential = await this.passkey.getCredential(this.verification.options, {
        signal: this.controller.signal,
      });

      if (this.disposed) return;
      await this.passkey.verifyRegistration(this.verification.id, credential);
      await this.auth.ensureSessionLoaded(true);
      if (this.disposed) return;
      this.stage.set('done');
      await this.router.navigateByUrl(SECURITY_URL);
    } catch {
      this.error.set($localize`:@@approvalVerificationFailed:Passkey verification was not completed. Try again.`);
    } finally {
      this.busy.set(false);
    }
  }

  protected async copyLink(): Promise<void> {
    try {
      const clipboard = this.document.defaultView?.navigator.clipboard;

      if (!clipboard) throw new Error('Clipboard unavailable');
      await clipboard.writeText(this.link());
      this.notice.set($localize`:@@approvalLinkCopied:Link copied.`);
    } catch {
      this.notice.set($localize`:@@approvalCopyFailed:Select and copy the link below.`);
    }
  }

  protected statusLabel(status: ApprovalStatus): string {
    switch (status) {
      case 'pending':
        return $localize`:@@approvalPending:Waiting for approval`;
      case 'approved':
        return $localize`:@@approvalApproved:Approved for passkey setup`;
      case 'denied':
        return $localize`:@@approvalDenied:Request denied`;
      case 'cancelled':
        return $localize`:@@approvalCancelled:Request cancelled`;
      case 'consumed':
        return $localize`:@@approvalConsumed:Setup authorization already used`;
      case 'expired':
        return $localize`:@@approvalExpired:Request expired`;
    }
  }
}
