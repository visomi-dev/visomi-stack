import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { APP_URL, SIGN_IN_URL } from '../../shared/constants/routes';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';
import { Link } from '../../shared/ui/typography/link/link';
import { VerificationCodeForm } from '../verification-code-form/verification-code-form';

@Component({
  host: {
    class: /* tw */ 'block min-h-full w-full',
  },
  imports: [AuthCard, AuthLayout, Link, RouterLink, VerificationCodeForm],
  selector: 'app-verify-device',
  templateUrl: './verify-device.html',
  styleUrl: './verify-device.css',
})
export class VerifyDevice {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly challenge = this.auth.pendingChallenge;
  readonly verificationSubmitting = this.auth.verificationSubmitting;
  readonly errorMessage = signal('');
  readonly pinManualError = signal<string | null>(null);
  readonly statusMessage = signal('');

  async submit(pin: string) {
    this.pinManualError.set(null);
    this.errorMessage.set('');
    this.statusMessage.set('');

    try {
      await this.auth.submitVerification(pin);
      await this.router.navigate([APP_URL]);
    } catch (error) {
      this.errorMessage.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? $localize`:@@verifyDeviceFailed:Device verification failed.`)
          : $localize`:@@verifyDeviceFailed:Device verification failed.`,
      );
      this.pinManualError.set(
        error instanceof HttpErrorResponse
          ? $localize`:@@verifyDevicePinMismatch:The code didn't match. Try again.`
          : $localize`:@@verifyDevicePinMismatch:The code didn't match. Try again.`,
      );
    }
  }

  async resend() {
    this.pinManualError.set(null);
    this.errorMessage.set('');
    this.statusMessage.set('');

    try {
      await this.auth.resendVerification();
      this.statusMessage.set($localize`:@@verifyDeviceResendSuccess:A fresh device verification code was sent.`);
    } catch (error) {
      this.errorMessage.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? $localize`:@@verifyDeviceResendFailed:Could not resend the device code.`)
          : $localize`:@@verifyDeviceResendFailed:Could not resend the device code.`,
      );
    }
  }

  protected readonly signInUrl = SIGN_IN_URL;
}
