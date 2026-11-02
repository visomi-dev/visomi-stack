import { Component, ElementRef, afterNextRender, input, signal, viewChild } from '@angular/core';

@Component({
  selector: 'app-totp-qr',
  template: `<div class="inline-block rounded-xl bg-white p-3">
      <canvas
        #canvas
        role="img"
        aria-label="Scan this QR code with your authenticator app, or enter the manual key below."
        i18n-aria-label="@@authQrLabel"
        class="max-w-full"
      ></canvas>
    </div>
    @if (failed()) {
      <p role="status" i18n="@@authQrFailed">The QR code could not be displayed. Use the manual key below.</p>
    }`,
})
export class QrCode {
  readonly uri = input.required<string>();

  readonly failed = signal(false);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    afterNextRender(() => {
      void import('qrcode')
        .then((module) => module.default)
        .then((qr) =>
          qr.toCanvas(this.canvas().nativeElement, this.uri(), { width: 240, margin: 4, errorCorrectionLevel: 'M' }),
        )
        .catch(() => this.failed.set(true));
    });
  }
}
