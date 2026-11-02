import { Component, ElementRef, afterNextRender, input, signal, viewChild } from '@angular/core';

@Component({
  selector: 'app-totp-qr',
  templateUrl: './qr-code.html',
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
