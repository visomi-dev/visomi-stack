import { Component, ElementRef, afterRenderEffect, input, signal, viewChild } from '@angular/core';

@Component({
  selector: 'app-totp-qr',
  templateUrl: './qr-code.html',
})
export class QrCode {
  readonly uri = input.required<string>();

  readonly failed = signal(false);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    afterRenderEffect({
      write: (onCleanup) => {
        const canvas = this.canvas().nativeElement;
        const uri = this.uri();
        let active = true;

        onCleanup(() => {
          active = false;
        });
        canvas.width = 240;
        canvas.height = 240;
        this.failed.set(false);
        void import('qrcode')
          .then((module) => module.default)
          .then((qr) => {
            if (active) {
              return qr.toCanvas(canvas, uri, { width: 240, margin: 4, errorCorrectionLevel: 'M' });
            }

            return undefined;
          })
          .catch(() => {
            if (active) {
              this.failed.set(true);
            }
          });
      },
    });
  }
}
