import { DOCUMENT } from '@angular/common';
import { Component, afterRenderEffect, inject, input, signal } from '@angular/core';

import { Button, LinkButton, Text } from '../../ui';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';

@Component({
  selector: 'app-backup-display',
  imports: [Button, LinkButton, Text, AuthFeedback],
  providers: [Action],
  templateUrl: './backup-display.html',
})
export class BackupDisplay {
  private readonly document = inject(DOCUMENT);
  readonly action = inject(Action);

  readonly codes = input.required<string[]>();

  protected readonly downloadUrl = signal<string | null>(null);

  copy(): void {
    void this.action.run(async () => {
      await this.document.defaultView!.navigator.clipboard.writeText(this.codes().join('\n'));

      this.action.setNotice($localize`:@@authCopied:Copied.`);
    });
  }

  private readonly prepareDownload = afterRenderEffect({
    write: (onCleanup) => {
      const codes = this.codes();

      this.downloadUrl.set(null);

      if (!codes.length || typeof URL.createObjectURL !== 'function') {
        return;
      }

      // Blob URLs are browser resources whose lifetime follows the displayed codes.
      const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);

      this.downloadUrl.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    },
  });
}
