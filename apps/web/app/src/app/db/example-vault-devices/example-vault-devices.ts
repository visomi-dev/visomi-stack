import {
  Component,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import {
  Alert,
  Badge,
  Button,
  Card,
  Disclosure,
  Field,
  Heading,
  Input,
  Label,
  Link,
  PinInput,
  Text,
  Textarea,
} from '../../ui';
import { type ExampleTarget } from '../example-contracts';
import { ExampleVaultPairing } from '../example-vault-pairing';
import { ExampleVaultPairingNotices } from '../example-vault-pairing-notices';

@Component({
  selector: 'app-example-vault-devices',
  imports: [
    Alert,
    Badge,
    Button,
    Card,
    Disclosure,
    Field,
    Heading,
    Input,
    Label,
    Link,
    PinInput,
    Text,
    Textarea,
    RouterLink,
    NgTemplateOutlet,
  ],
  providers: [ExampleVaultPairing],
  templateUrl: './example-vault-devices.html',
})
export class ExampleVaultDevices {
  private readonly notices = inject(ExampleVaultPairingNotices, { optional: true });
  private readonly document = inject(DOCUMENT);

  private readonly reviewOutcome = viewChild<ElementRef<HTMLElement>>('reviewOutcome');

  protected readonly pairing = inject(ExampleVaultPairing);

  protected readonly reviewCode = signal('');

  readonly target = input.required<ExampleTarget>();

  protected readonly hasPendingReview = computed(() => {
    const { tenantId, scopeId, objectId } = this.target();

    return (
      this.notices
        ?.pending()
        .some(
          (request) => request.tenantId === tenantId && request.scopeId === scopeId && request.objectId === objectId,
        ) ?? false
    );
  });

  readonly backed = input(false);
  protected readonly resourceLink = computed(() => {
    const { tenantId, scopeId, objectId } = this.target();

    return this.backed() ? ['/db-example/vault'] : ['/db-example', tenantId, scopeId, objectId];
  });
  protected readonly resourceParams = computed(() => (this.backed() ? this.target() : null));
  protected readonly spokenCode = computed(() => {
    const digits = this.pairing.code().replaceAll(' ', '').split('').join(' ');

    return $localize`:@@vaultPairingSpokenCode:Pairing code, ${digits}:digits:`;
  });

  protected readonly codeLabel = $localize`:@@vaultPairingCodeLabel:Pairing code`;
  protected readonly fingerprintLabel = $localize`:@@vaultDevicesRecipientFingerprint:New device fingerprint`;

  protected manualProof = '';

  readonly review = input<string>();
  readonly rpId = input.required<string>();

  protected approveManually(event: Event, credential: HTMLInputElement): void {
    event.preventDefault();
    void this.pairing.approve(this.manualProof, credential.value);
  }

  protected approveCode(event: Event): void {
    event.preventDefault();
    const code = this.reviewCode();

    this.reviewCode.set('');
    void this.pairing.approveReview(code);
  }

  protected async copyReviewLink(link: string): Promise<void> {
    try {
      await this.document.defaultView!.navigator.clipboard.writeText(link);

      this.pairing.message.set($localize`:@@vaultPairingLinkCopied:Review link copied.`);
    } catch {
      this.pairing.message.set($localize`:@@vaultPairingLinkCopyFailed:Select and copy the review link below.`);
    }
  }

  private readonly initialize = afterNextRender(
    () => void this.pairing.initialize(this.target(), this.rpId(), this.backed()),
  );

  private readonly loadReview = effect((cleanup) => {
    const requestId = this.review();

    if (!this.backed() || !this.pairing.ready()) {
      return;
    }

    const controller = new AbortController();
    const ready = untracked(() => this.pairing.approverReady());

    this.reviewCode.set('');
    void this.pairing.loadReview(ready ? requestId : undefined, controller.signal);
    cleanup(() => controller.abort());
  });

  private readonly focusReviewOutcome = afterRenderEffect({
    write: () => {
      const outcome = this.reviewOutcome();

      if (outcome && this.document.activeElement === this.document.body) {
        outcome.nativeElement.focus();
      }
    },
  });
}
