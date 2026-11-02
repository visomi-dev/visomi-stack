import { DOCUMENT } from '@angular/common';
import { Component, inject, input } from '@angular/core';

import { Button, Text } from '../../ui';
import { Action } from '../shared/action';
import { AuthFeedback } from '../shared/feedback';

@Component({
  selector: 'app-backup-display',
  imports: [Button, Text, AuthFeedback],
  templateUrl: './backup-display.html',
})
export class BackupDisplay {
  private readonly document = inject(DOCUMENT);

  readonly codes = input.required<string[]>();

  readonly action = new Action();

  copy(): void {
    void this.action.run(async () => {
      await this.document.defaultView!.navigator.clipboard.writeText(this.codes().join('\n'));

      this.action.notice.set($localize`:@@authCopied:Copied.`);
    });
  }

  download(): void {
    void this.action.run(async () => {
      const blob = new Blob([this.codes().join('\n') + '\n'], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = this.document.createElement('a');

      anchor.href = url;
      anchor.download = 'visomi-backup-codes.txt';
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }
}
